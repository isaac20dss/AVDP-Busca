//! Mensagens: parágrafos, agrupamento por data (várias traduções), busca e importação.

use crate::db::Result;
use crate::error::AppError;
use crate::search::{self, QueryOpts};
use crate::text::{fold, squash_spaces, words};
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

// ---------- texto -> parágrafos ----------

#[derive(Debug, Default, Clone, PartialEq)]
pub struct ParsedMessage {
    pub header: Vec<String>,
    pub translation: Option<String>,
    pub place: Option<String>,
    pub paragraphs: Vec<(u32, String)>,
}

static NUMBERED: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(\d{1,4})\s+(\S.*)$").unwrap());
/// Número de parágrafo nos PDFs da VGR (fonte própria): ` = 1 e ‚ƒ„…†‡ˆ‰Š‹ = 0..9.
static VGR_NUMBERED: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(`|[‚ƒ„…†‡ˆ‰Š‹]{1,4})\s+(\S.*)$").unwrap());
static DATE_LINE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(19[4-6]\d)\b|\bde (janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b").unwrap()
});
static TRANSLATION_LINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^tradu[cç][aã]o\s*[:–—-]\s*(.+)$").unwrap());
static ENCLITIC: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(\w) -(nos|los|las|lo|la|me|te|se|lhe|lhes|vos|o|a|os|as|ei|á|ás|ão|emos|ia|iam)\b").unwrap()
});

fn clean_line(s: &str) -> String {
    let s: String = s
        .chars()
        .filter(|c| !('\u{e000}'..='\u{f8ff}').contains(c) && *c != '\u{ad}')
        .map(|c| match c {
            '\u{a0}' => ' ',
            '_' => '—', // VGR: gaguejo/interrupção ("no_no")
            '^' => '…', // VGR: frase interrompida
            _ => c,
        })
        .collect();
    squash_spaces(&s)
}

fn vgr_number(tok: &str) -> Option<u32> {
    if tok == "`" {
        return Some(1);
    }
    let mut n = 0u32;
    for c in tok.chars() {
        let d = "‚ƒ„…†‡ˆ‰Š‹".chars().position(|x| x == c)? as u32;
        n = n * 10 + d;
    }
    Some(n)
}

/// Linha que começa com número de parágrafo (dígitos ou símbolos da VGR).
fn numbered(line: &str) -> Option<(u32, String)> {
    if let Some(c) = NUMBERED.captures(line) {
        return Some((c[1].parse().ok()?, c[2].to_string()));
    }
    let c = VGR_NUMBERED.captures(line)?;
    Some((vgr_number(&c[1])?, c[2].to_string()))
}

fn is_noise(line: &str) -> bool {
    let l = line.trim();
    if l.is_empty() || l.chars().all(|c| c.is_ascii_digit() || c.is_whitespace() || c == '.') {
        return true;
    }
    let low = l.to_lowercase();
    if ["www.", "e-mail", "fone/fax", "fone:", "cx. postal", "cep ", "http://", "https://"].iter().any(|k| low.contains(k)) && l.len() < 140 {
        return true;
    }
    // cabeçalho de página: "2 CRENTES DA BÍBLIA", "A IGREJA IRÁ ANTES 3"
    let letters: Vec<char> = l.chars().filter(|c| c.is_alphabetic()).collect();
    if l.chars().count() <= 70 && letters.len() >= 4 {
        let upper = letters.iter().filter(|c| c.is_uppercase()).count();
        if upper * 10 >= letters.len() * 9 {
            return true;
        }
    }
    false
}

fn join_wrapped(cur: &mut String, next: &str) {
    if cur.is_empty() {
        cur.push_str(next);
    } else if cur.ends_with('-') && next.chars().next().is_some_and(|c| c.is_lowercase()) {
        cur.push_str(next);
    } else {
        cur.push(' ');
        cur.push_str(next);
    }
}

/// Divide parágrafos longos (textos sem numeração) em blocos no fim de frases.
fn split_long(text: &str, max: usize) -> Vec<String> {
    if text.chars().count() <= max {
        return vec![text.to_string()];
    }
    let target = max * 6 / 10;
    let mut out: Vec<String> = vec![];
    let mut cur = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        cur.push(c);
        let end_sentence = matches!(c, '.' | '?' | '!' | '”' | '"') && chars.peek().is_some_and(|n| n.is_whitespace());
        if end_sentence && cur.chars().count() >= target {
            out.push(cur.trim().to_string());
            cur.clear();
        }
    }
    if !cur.trim().is_empty() {
        if cur.chars().count() < target / 3 && !out.is_empty() {
            let last = out.last_mut().unwrap();
            last.push(' ');
            last.push_str(cur.trim());
        } else {
            out.push(cur.trim().to_string());
        }
    }
    out
}

struct Line {
    text: String,
    trailing_space: bool,
    blank_before: bool,
}

/// `hard_breaks`: cada linha é um bloco (HTML `<p>`); senão as linhas são quebras de PDF.
pub fn parse_message(text: &str, hard_breaks: bool) -> ParsedMessage {
    let mut lines: Vec<Line> = vec![];
    let mut blank = false;
    for raw in text.lines() {
        let t = clean_line(raw);
        if t.is_empty() {
            blank = true;
            continue;
        }
        let trailing_space = raw.ends_with([' ', '\t', '\u{a0}']);
        lines.push(Line { text: t, trailing_space, blank_before: blank });
        blank = false;
    }
    let mut out = ParsedMessage::default();

    // cabeçalho: título, título em inglês, autor, data, local, tradução (linhas curtas do começo)
    let mut header_end = 0;
    for (i, ln) in lines.iter().enumerate().take(9) {
        let l = &ln.text;
        let len = l.chars().count();
        if len > 90 || (i > 0 && numbered(l).is_some() && !DATE_LINE.is_match(l)) {
            break;
        }
        let low = l.to_lowercase();
        let compact: String = low.chars().filter(|c| !c.is_whitespace()).collect();
        let short_label = (len <= 60 && !l.ends_with(['.', '!', '?', ',', ';', ':', '"', '”', '…']))
            || (len <= 70 && (compact.ends_with("e.u.a.") || compact.ends_with("e.u.a")));
        if i == 0 || TRANSLATION_LINE.is_match(l) || low.contains("branham") || (DATE_LINE.is_match(l) && len <= 60) || short_label {
            header_end = i + 1;
        } else {
            break;
        }
    }
    out.header = lines[..header_end.min(lines.len())].iter().map(|l| l.text.clone()).collect();
    out.translation = out.header.iter().find_map(|l| TRANSLATION_LINE.captures(l).map(|c| c[1].trim().to_string()));
    out.place = out
        .header
        .iter()
        .skip(1)
        .find(|l| {
            let low = l.to_lowercase();
            !DATE_LINE.is_match(l)
                && !TRANSLATION_LINE.is_match(l)
                && !low.contains("branham")
                && (low.replace(' ', "").contains("e.u.a") || low.contains(" – ") || low.contains(" - ") || low.contains(','))
        })
        .cloned();

    let body = &lines[header_end.min(lines.len())..];
    let numbered_total = body.iter().filter(|l| numbered(&l.text).is_some()).count();
    let numbering = numbered_total >= 3;
    let trailing = body.iter().filter(|l| l.trailing_space).count() as f64 / body.len().max(1) as f64;
    let use_trailing = !numbering && !hard_breaks && trailing > 0.5 && trailing < 0.97;
    let mut paras: Vec<(u32, String)> = Vec::new();
    let mut seen_number = false;
    let mut prev_closed = false;

    for ln in body {
        let l = &ln.text;
        if numbering {
            if let Some((n, rest)) = numbered(l) {
                let expected = paras.last().map(|p| p.0 + 1).unwrap_or(1);
                let first_ok = !seen_number && (1..=3).contains(&n);
                if n > 0 && (n == expected || first_ok || (seen_number && n > expected && n <= expected + 2)) {
                    if first_ok && n == 1 && paras.len() == 1 && paras[0].0 == 1 {
                        paras[0].0 = 0; // texto antes do parágrafo 1 vira preâmbulo
                    }
                    paras.push((n, rest));
                    seen_number = true;
                    prev_closed = false;
                    continue;
                }
            }
        }
        if is_noise(l) {
            continue;
        }
        let start_new = paras.is_empty()
            || (hard_breaks && !numbering)
            || (!numbering && !hard_breaks && (ln.blank_before || prev_closed));
        if start_new {
            let n = paras.last().map(|p| p.0 + 1).unwrap_or(1);
            paras.push((n, l.clone()));
        } else if hard_breaks {
            let cur = &mut paras.last_mut().unwrap().1;
            cur.push(' ');
            cur.push_str(l);
        } else {
            join_wrapped(&mut paras.last_mut().unwrap().1, l);
        }
        prev_closed = use_trailing && !ln.trailing_space;
    }
    let mut cleaned: Vec<(u32, String)> = paras
        .into_iter()
        .map(|(n, t)| (n, ENCLITIC.replace_all(&squash_spaces(&t), "$1-$2").into_owned()))
        .filter(|(_, t)| !t.is_empty())
        .collect();
    if !numbering {
        // sem numeração: blocos de tamanho de leitura, numerados em sequência
        cleaned = cleaned
            .into_iter()
            .flat_map(|(_, t)| split_long(&t, 1300))
            .enumerate()
            .map(|(i, t)| (i as u32 + 1, t))
            .collect();
    }
    out.paragraphs = cleaned;
    out
}

/// `<p>` do HTML viram linhas.
pub fn html_to_lines(html: &str) -> String {
    static P: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)</p\s*>|<br\s*/?>|</h\d>|</li>|</div>").unwrap());
    static TAG: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<[^>]+>").unwrap());
    let s = P.replace_all(html, "\n");
    let s = TAG.replace_all(&s, "");
    decode_entities(&s)
}

pub fn decode_entities(s: &str) -> String {
    static ENT: Lazy<Regex> = Lazy::new(|| Regex::new(r"&(#x?[0-9a-fA-F]+|[a-zA-Z]+);").unwrap());
    ENT.replace_all(s, |c: &regex::Captures| {
        let e = &c[1];
        if let Some(num) = e.strip_prefix('#') {
            let v = if let Some(h) = num.strip_prefix(['x', 'X']) { u32::from_str_radix(h, 16).ok() } else { num.parse().ok() };
            return v.and_then(char::from_u32).map(|ch| ch.to_string()).unwrap_or_default();
        }
        match e {
            "nbsp" => " ",
            "amp" => "&",
            "quot" => "\"",
            "apos" => "'",
            "lt" => "<",
            "gt" => ">",
            "ndash" => "–",
            "mdash" => "—",
            "hellip" => "…",
            "ldquo" => "“",
            "rdquo" => "”",
            "lsquo" => "‘",
            "rsquo" => "’",
            _ => "",
        }
        .to_string()
    })
    .into_owned()
}

// ---------- datas ----------

/// "1958-0309N" | "1959-11-23" | "58-0309N" | "65-1127B" -> (AAAA-MMDD, sufixo)
pub fn parse_date(raw: &str) -> Option<(String, String)> {
    static FULL: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(\d{4})-(\d{2})-?(\d{2})\s*([A-Za-z]?)\s*$").unwrap());
    static SHORT: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(\d{2})[-./ ]?(\d{2})(\d{2})\s*([A-Za-z]?)\s*$").unwrap());
    static BR: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s*$").unwrap());
    if let Some(c) = FULL.captures(raw) {
        return Some((format!("{}-{}{}", &c[1], &c[2], &c[3]), c[4].to_uppercase()));
    }
    if let Some(c) = SHORT.captures(raw) {
        return Some((format!("19{}-{}{}", &c[1], &c[2], &c[3]), c[4].to_uppercase()));
    }
    if let Some(c) = BR.captures(raw) {
        let y = if c[3].len() == 2 { format!("19{}", &c[3]) } else { c[3].to_string() };
        return Some((format!("{y}-{:0>2}{:0>2}", &c[2], &c[1]), String::new()));
    }
    None
}

pub fn code_for(date_key: &str, suffix: &str) -> String {
    if date_key.len() >= 9 {
        format!("{}-{}{}", &date_key[2..4], &date_key[5..9], suffix)
    } else {
        format!("{date_key}{suffix}")
    }
}

// ---------- gravação ----------

pub struct NewVariant<'a> {
    pub source: &'a str,
    pub source_id: String,
    pub date_key: String,
    pub suffix: String,
    pub translation: String,
    pub title: String,
    pub local: String,
    pub pdf_url: String,
    pub audio_url: String,
    pub page_url: String,
    pub paragraphs: Vec<(u32, String)>,
}

/// Número de título, também ordinal ("2", "1ª", "1º", "2a").
fn title_number(w: &str) -> Option<&str> {
    let digits = w.trim_end_matches(['ª', 'º', 'a', 'o']);
    (!digits.is_empty() && digits.len() + 2 >= w.len() && digits.chars().all(|c| c.is_ascii_digit())).then_some(digits)
}

/// Números e romanos do título ("Israel no Mar Vermelho 2", "Adoção III", "Hebreus 6 – 2ª Parte").
fn title_numbers(ws: &[String]) -> std::collections::BTreeSet<String> {
    ws.iter()
        .filter(|w| title_number(w).is_some() || matches!(w.as_str(), "i" | "ii" | "iii" | "iv" | "v" | "vi" | "vii" | "viii" | "ix" | "x"))
        .map(|w| match w.as_str() {
            "i" => "1".into(),
            "ii" => "2".into(),
            "iii" => "3".into(),
            "iv" => "4".into(),
            "v" => "5".into(),
            "vi" => "6".into(),
            "vii" => "7".into(),
            "viii" => "8".into(),
            "ix" => "9".into(),
            "x" => "10".into(),
            _ => title_number(w).unwrap_or(w).trim_start_matches('0').to_string(),
        })
        .collect()
}

/// Semelhança de títulos (0..1). Partes com números diferentes ("1" x "2") nunca são a mesma.
pub fn title_similarity(a: &str, b: &str) -> f64 {
    title_sim(a, b, false)
}

/// Semelhança para traduções da mesma data: vale também o título curto contido no outro
/// ("Eu Sei" ~ "Eu Sei (Mensagem da Páscoa)").
pub fn title_similarity_same_day(a: &str, b: &str) -> f64 {
    title_sim(a, b, true)
}

fn title_sim(a: &str, b: &str, contained: bool) -> f64 {
    let wa_all = words(a);
    let wb_all = words(b);
    let (na, nb) = (title_numbers(&wa_all), title_numbers(&wb_all));
    if !na.is_empty() && !nb.is_empty() && na != nb {
        return 0.0;
    }
    let keep = |w: &String| w.len() > 2 && title_number(w).is_none();
    let wa: std::collections::HashSet<String> = wa_all.iter().filter(|w| keep(w)).cloned().collect();
    let wb: std::collections::HashSet<String> = wb_all.iter().filter(|w| keep(w)).cloned().collect();
    if wa.is_empty() || wb.is_empty() {
        return 0.0;
    }
    let inter = wa.intersection(&wb).count();
    let mut sim = inter as f64 / wa.union(&wb).count() as f64;
    // partes numeradas iguais com palavra em comum ("Hebreus 6 – 2ª Parte" ~ "Hebreus, Capítulo 6 #2")
    if !na.is_empty() && na == nb && inter > 0 {
        sim = sim.max(0.5);
    }
    if contained && inter == wa.len().min(wb.len()) {
        sim = sim.max(0.5);
    }
    sim
}

struct Candidate {
    gid: i64,
    suffix: String,
    /// Maior semelhança entre o título novo e os títulos das traduções do grupo.
    sim: f64,
    /// O grupo já tem tradução desta mesma fonte (outra mensagem, em princípio).
    same_source: bool,
    /// Alguma tradução do grupo (fora a própria, na reimportação) tem texto.
    has_text: bool,
    /// Traduções no grupo fora a própria.
    others: usize,
}

fn candidates(tx: &Transaction, sql_where: &str, arg: &dyn rusqlite::ToSql, v: &NewVariant, same_day: bool) -> Result<Vec<Candidate>> {
    let mut st = tx.prepare(&format!(
        "SELECT g.id, g.suffix, x.source, x.source_id, x.title, x.para_count FROM msg_groups g LEFT JOIN msg_variants x ON x.group_id = g.id WHERE {sql_where}"
    ))?;
    let rows = st.query_map([arg], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<i64>>(5)?,
        ))
    })?;
    let mut by: Vec<Candidate> = vec![];
    for row in rows {
        let (gid, suffix, src, sid, title, paras) = row?;
        // a própria tradução (reimportação) não conta
        if src.is_none() || (src.as_deref() == Some(v.source) && sid.as_deref() == Some(v.source_id.as_str())) {
            if !by.iter().any(|c| c.gid == gid) {
                by.push(Candidate { gid, suffix, sim: 0.0, same_source: false, has_text: false, others: 0 });
            }
            continue;
        }
        let has_text = paras.unwrap_or(0) > 0;
        let sim = title.as_deref().map(|t| if same_day { title_similarity_same_day(t, &v.title) } else { title_similarity(t, &v.title) }).unwrap_or(0.0);
        let same = src.as_deref() == Some(v.source);
        match by.iter_mut().find(|c| c.gid == gid) {
            Some(c) => {
                c.sim = c.sim.max(sim);
                c.same_source |= same;
                c.has_text |= has_text;
                c.others += 1;
            }
            None => by.push(Candidate { gid, suffix, sim, same_source: same, has_text, others: 1 }),
        }
    }
    Ok(by)
}

/// Acha (ou cria) o grupo da mensagem. Traduções da mesma data ficam juntas; o Busca CBB usa
/// AAAA-01-01 quando só sabe o ano, e aí o encaixe é pelo título dentro do ano.
/// `strict`: a fonte tem mais de uma mensagem nesta data, então só junta por título parecido
/// (sem o "único grupo do dia").
fn attach_group(tx: &Transaction, v: &NewVariant, strict: bool) -> Result<i64> {
    let (date_key, suffix) = (v.date_key.as_str(), v.suffix.as_str());
    let year: i64 = date_key.get(..4).and_then(|y| y.parse().ok()).unwrap_or(0);
    let only_year = v.source == "cbb" && suffix.is_empty() && date_key.ends_with("-0101");
    let create = |sfx: &str, code: String| -> Result<i64> {
        tx.execute(
            "INSERT INTO msg_groups(date_key, suffix, code, year, title, local) VALUES (?1,?2,?3,?4,?5,?6)",
            params![date_key, sfx, code, year, v.title, v.local],
        )?;
        Ok(tx.last_insert_rowid())
    };
    let accept = |c: &Candidate| c.sim >= if c.same_source { 0.75 } else { 0.4 };

    if only_year {
        let mut cands = candidates(tx, "g.year = ?1", &year, v, false)?;
        cands.sort_by(|a, b| b.sim.partial_cmp(&a.sim).unwrap_or(std::cmp::Ordering::Equal));
        if let Some(c) = cands.iter().find(|c| accept(c)) {
            return Ok(c.gid);
        }
        let own = format!("~{}", v.source_id);
        if let Some(c) = cands.iter().find(|c| c.suffix == own) {
            return Ok(c.gid);
        }
        return create(&own, format!("{}-????", &date_key[2..4]));
    }

    let cands = candidates(tx, "g.date_key = ?1", &date_key, v, true)?;
    if !suffix.is_empty() {
        if let Some(c) = cands.iter().find(|c| c.suffix == suffix) {
            return Ok(c.gid);
        }
    } else {
        // sem sufixo: o grupo de título mais parecido; se só há um grupo no dia e é de outra fonte, junta
        let best = cands.iter().max_by(|a, b| a.sim.partial_cmp(&b.sim).unwrap_or(std::cmp::Ordering::Equal));
        if let Some(c) = best {
            if accept(c) || (cands.len() == 1 && !c.same_source && !strict && same_text_or_unknown(tx, c.gid, v)?) {
                return Ok(c.gid);
            }
        }
        // um só grupo do dia sem texto nenhum (só o título, às vezes em inglês): o texto entra nele
        if !v.paragraphs.is_empty() {
            let mut empty = cands.iter().filter(|c| c.others > 0 && !c.has_text && !c.same_source);
            if let (Some(c), None) = (empty.next(), empty.next()) {
                return Ok(c.gid);
            }
        }
        let own = format!("~{}", v.source_id);
        if let Some(c) = cands.iter().find(|c| c.suffix == own) {
            return Ok(c.gid);
        }
        return create(if cands.is_empty() { "" } else { &own }, code_for(date_key, ""));
    }
    // com sufixo (banco local): grupo sem sufixo de outra fonte, sozinho no dia, ganha o sufixo
    if cands.len() == 1 && cands[0].suffix.is_empty() && !cands[0].same_source {
        tx.execute("UPDATE msg_groups SET suffix=?1, code=?2 WHERE id=?3", params![suffix, code_for(date_key, suffix), cands[0].gid])?;
        return Ok(cands[0].gid);
    }
    if let Some(c) = cands.iter().filter(|c| c.suffix.is_empty() || c.suffix.starts_with('~')).find(|c| accept(c)) {
        tx.execute("UPDATE msg_groups SET suffix=?1, code=?2 WHERE id=?3", params![suffix, code_for(date_key, suffix), c.gid])?;
        return Ok(c.gid);
    }
    create(suffix, code_for(date_key, suffix))
}

/// Juntar pelo "único grupo do dia" só se o texto não desmentir: quando o grupo já tem a mesma
/// tradução com texto, o texto novo tem de ser quase igual (data errada no site junta mensagens diferentes).
fn same_text_or_unknown(tx: &Transaction, gid: i64, v: &NewVariant) -> Result<bool> {
    if v.translation.is_empty() || v.paragraphs.is_empty() {
        return Ok(true);
    }
    let ids: Vec<i64> = {
        let mut st = tx.prepare_cached("SELECT id FROM msg_variants WHERE group_id=?1 AND translation=?2 AND para_count > 0 AND NOT (source=?3 AND source_id=?4)")?;
        let rows = st.query_map(params![gid, v.translation, v.source, v.source_id], |r| r.get(0))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    if ids.is_empty() {
        return Ok(true);
    }
    let new = word_pairs(v.paragraphs.iter().map(|(_, t)| t.as_str()));
    for id in ids {
        if pair_similarity(&new, &variant_pairs(tx, id)?) >= SAME_TEXT {
            return Ok(true);
        }
    }
    Ok(false)
}

// ---------- cópias iguais da mesma tradução ----------

/// Duas cópias da mesma tradução (revisões) passam de 0,8 nos pares de palavras; traduções
/// diferentes da mesma mensagem ficam bem abaixo de 0,4.
const SAME_TEXT: f64 = 0.6;

/// Pares de palavras seguidas do texto inteiro (sem acento), como números.
pub fn word_pairs<'a>(paras: impl Iterator<Item = &'a str>) -> std::collections::HashSet<u64> {
    use std::hash::{Hash, Hasher};
    let mut out = std::collections::HashSet::new();
    let mut prev: Option<String> = None;
    for p in paras {
        for w in words(p) {
            if let Some(pw) = &prev {
                let mut h = std::collections::hash_map::DefaultHasher::new();
                (pw, &w).hash(&mut h);
                out.insert(h.finish());
            }
            prev = Some(w);
        }
    }
    out
}

pub fn pair_similarity(a: &std::collections::HashSet<u64>, b: &std::collections::HashSet<u64>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count();
    inter as f64 / (a.len() + b.len() - inter) as f64
}

pub fn variant_pairs(conn: &Connection, vid: i64) -> Result<std::collections::HashSet<u64>> {
    let mut st = conn.prepare_cached("SELECT text FROM msg_paragraphs WHERE variant_id=?1 ORDER BY seq")?;
    let texts: Vec<String> = st.query_map([vid], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
    Ok(word_pairs(texts.iter().map(|t| t.as_str())))
}

/// O Tabernáculo da Fé traz a revisão mais nova das traduções GO e GVD (e o MessageHub, a da tradução
/// "Crentes da Bíblia do Brasil"). Onde o banco local ou o Busca CBB têm o mesmo texto (cópia antiga),
/// a cópia fica escondida (`superseded_by`): some da pesquisa e da escolha de tradução, mas continua
/// guardada e volta se a do site sumir.
pub fn mark_superseded(tx: &Transaction) -> Result<usize> {
    tx.execute("UPDATE msg_variants SET superseded_by = NULL WHERE superseded_by IS NOT NULL", [])?;
    let tdf: Vec<(i64, i64, String, i64)> = {
        let mut st = tx.prepare("SELECT id, group_id, translation, para_count FROM msg_variants WHERE source IN ('tdf','hub') AND para_count > 0 ORDER BY id")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    let mut n = 0;
    for (tid, gid, tr, count) in tdf {
        let others: Vec<(i64, String, i64)> = {
            let mut st = tx.prepare_cached("SELECT id, translation, para_count FROM msg_variants WHERE group_id=?1 AND source NOT IN ('tdf','hub') AND para_count > 0 AND superseded_by IS NULL AND edited = 0")?;
            let rows = st.query_map([gid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        if others.is_empty() {
            continue;
        }
        let mine = variant_pairs(tx, tid)?;
        for (o, o_tr, o_count) in others {
            // mesma sigla com quase nada (só a página de rosto do PDF, por exemplo): também sai
            let stub = o_tr == tr && o_count * 5 < count;
            if stub || pair_similarity(&mine, &variant_pairs(tx, o)?) >= SAME_TEXT {
                tx.execute("UPDATE msg_variants SET superseded_by=?1 WHERE id=?2", [tid, o])?;
                n += 1;
            }
        }
    }
    // tradução escolhida pelo operador que virou cópia escondida: passa para a revisão nova
    tx.execute(
        "UPDATE msg_groups SET preferred_variant = (SELECT v.superseded_by FROM msg_variants v WHERE v.id = msg_groups.preferred_variant)
         WHERE preferred_variant IN (SELECT id FROM msg_variants WHERE superseded_by IS NOT NULL)",
        [],
    )?;
    Ok(n)
}

/// Depois de uma sincronização: apaga grupos vazios e recalcula título/tradução padrão de todos.
pub fn tidy_groups(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM msg_groups WHERE id NOT IN (SELECT group_id FROM msg_variants)", [])?;
    tx.execute(
        "UPDATE msg_groups SET preferred_variant = NULL, chosen = 0
         WHERE preferred_variant IS NOT NULL
           AND preferred_variant NOT IN (SELECT v.id FROM msg_variants v WHERE v.group_id = msg_groups.id)",
        [],
    )?;
    mark_superseded(&tx)?;
    let ids: Vec<i64> = {
        let mut st = tx.prepare("SELECT id FROM msg_groups")?;
        let rows = st.query_map([], |r| r.get(0))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    for gid in ids {
        refresh_group(&tx, gid)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn save_variant(tx: &Transaction, v: &NewVariant) -> Result<i64> {
    save_variant_with(tx, v, false)
}

pub fn save_variant_with(tx: &Transaction, v: &NewVariant, strict: bool) -> Result<i64> {
    let gid = attach_group(tx, v, strict)?;
    save_into_group(tx, gid, v)
}

/// Grava (ou regrava) a tradução num grupo já escolhido.
pub fn save_into_group(tx: &Transaction, gid: i64, v: &NewVariant) -> Result<i64> {
    let existing: Option<(i64, i64)> = tx
        .query_row("SELECT id, edited FROM msg_variants WHERE source=?1 AND source_id=?2", params![v.source, v.source_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    // editada pelo operador: a sincronização não troca o texto (só o grupo e os dados de cima)
    if let Some((id, 1)) = existing {
        tx.execute(
            "UPDATE msg_variants SET group_id=?2, translation=?3, title=?4, title_fold=?5, local=?6, local_fold=?7, pdf_url=?8, audio_url=?9, page_url=?10 WHERE id=?1",
            params![id, gid, v.translation, v.title, fold(&v.title), v.local, fold(&v.local), v.pdf_url, v.audio_url, v.page_url],
        )?;
        refresh_group(tx, gid)?;
        return Ok(id);
    }
    let existing = existing.map(|(id, _)| id);
    let vid = if let Some(id) = existing {
        tx.execute("DELETE FROM msg_paragraphs WHERE variant_id=?1", [id])?;
        tx.execute(
            "UPDATE msg_variants SET group_id=?2, translation=?3, title=?4, title_fold=?5, local=?6, local_fold=?7,
               pdf_url=?8, audio_url=?9, page_url=?10, para_count=?11 WHERE id=?1",
            params![id, gid, v.translation, v.title, fold(&v.title), v.local, fold(&v.local), v.pdf_url, v.audio_url, v.page_url, v.paragraphs.len() as i64],
        )?;
        id
    } else {
        tx.execute(
            "INSERT INTO msg_variants(group_id, source, source_id, translation, title, title_fold, local, local_fold,
               pdf_url, audio_url, page_url, para_count) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![gid, v.source, v.source_id, v.translation, v.title, fold(&v.title), v.local, fold(&v.local), v.pdf_url, v.audio_url, v.page_url, v.paragraphs.len() as i64],
        )?;
        tx.last_insert_rowid()
    };
    {
        let mut st = tx.prepare_cached("INSERT INTO msg_paragraphs(variant_id, num, seq, text) VALUES (?1,?2,?3,?4)")?;
        for (i, (n, t)) in v.paragraphs.iter().enumerate() {
            st.execute(params![vid, n, i as i64, t])?;
        }
    }
    refresh_group(tx, gid)?;
    Ok(vid)
}

/// Atualiza título/local do grupo e a tradução padrão (se o usuário ainda não escolheu).
pub fn refresh_group(tx: &Transaction, gid: i64) -> Result<()> {
    let best: Option<(i64, String, String)> = tx
        .query_row(
            "SELECT id, title, local FROM msg_variants WHERE group_id=?1
             ORDER BY (para_count > 0) DESC, (superseded_by IS NULL) DESC,
                      CASE source WHEN 'local' THEN 0 WHEN 'tdf' THEN 0 WHEN 'livro' THEN 0 WHEN 'cbb' THEN 1 WHEN 'hub' THEN 1 ELSE 2 END, para_count DESC LIMIT 1",
            [gid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    if let Some((vid, title, local)) = best {
        tx.execute(
            "UPDATE msg_groups SET title=?2, local=CASE WHEN ?3 <> '' THEN ?3 ELSE local END,
               preferred_variant=CASE WHEN chosen=1 THEN preferred_variant ELSE ?1 END WHERE id=?4",
            params![vid, title, local, gid],
        )?;
    }
    Ok(())
}

// ---------- importação: banco local ----------

#[derive(Serialize, Default)]
pub struct ImportReport {
    pub read: usize,
    pub with_text: usize,
    pub paragraphs: usize,
    pub groups: i64,
}

pub fn import_local_db(conn: &mut Connection, path: &std::path::Path) -> Result<ImportReport> {
    let src = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut st = src.prepare(
        "SELECT id, numero, titulo, data_sermao, traducao, texto, pdf_url, mp3_url, sermon_url, fonte_extraida FROM mensagens",
    )?;
    type Row = (i64, Option<i64>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>);
    let rows: Vec<Row> = st
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?))
        })?
        .collect::<std::result::Result<_, _>>()?;
    let mut rep = ImportReport::default();
    crate::db::bulk_fts(conn, "msg_paragraphs", "msg_fts", &["text"], |tx| {
        for (id, numero, titulo, data, trad, texto, pdf, mp3, page, _fonte) in rows {
            rep.read += 1;
            let Some((date_key, suffix)) = data.as_deref().and_then(parse_date) else { continue };
            let parsed = texto.as_deref().map(|t| parse_message(t, false)).unwrap_or_default();
            if !parsed.paragraphs.is_empty() {
                rep.with_text += 1;
                rep.paragraphs += parsed.paragraphs.len();
            }
            let translation = trad.filter(|t| !t.is_empty()).or(parsed.translation.clone()).unwrap_or_default();
            save_variant(
                tx,
                &NewVariant {
                    source: "local",
                    source_id: numero.unwrap_or(id).to_string(),
                    date_key,
                    suffix,
                    translation,
                    title: titulo.unwrap_or_default(),
                    local: parsed.place.clone().unwrap_or_default(),
                    pdf_url: pdf.unwrap_or_default(),
                    audio_url: mp3.unwrap_or_default(),
                    page_url: page.unwrap_or_default(),
                    paragraphs: parsed.paragraphs,
                },
            )?;
        }
        Ok(())
    })?;
    rep.groups = conn.query_row("SELECT count(*) FROM msg_groups", [], |r| r.get(0))?;
    Ok(rep)
}

// ---------- importação: Busca CBB ----------

#[derive(Deserialize, Debug)]
pub struct CbbItem {
    pub id: i64,
    #[serde(default)]
    pub titulo: Option<String>,
    #[serde(default)]
    pub data: Option<String>,
    #[serde(default)]
    pub local: Option<String>,
    #[serde(default)]
    pub doc: Option<String>,
    #[serde(default)]
    pub traducao: Option<String>,
    #[serde(default)]
    pub paragrafos: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct CbbPage {
    #[serde(default)]
    pub data: Vec<CbbItem>,
    #[serde(default)]
    pub total: Option<i64>,
}

pub fn save_cbb_items(conn: &mut Connection, items: &[CbbItem]) -> Result<usize> {
    let tx = conn.transaction()?;
    let mut n = 0;
    for it in items {
        let Some((date_key, suffix)) = it.data.as_deref().and_then(parse_date) else { continue };
        let html = it.paragrafos.clone().unwrap_or_default();
        let parsed = parse_message(&html_to_lines(&html), true);
        let pdf = it
            .doc
            .as_deref()
            .and_then(|d| serde_json::from_str::<Vec<String>>(d).ok())
            .and_then(|v| v.into_iter().next())
            .unwrap_or_default();
        save_variant(
            &tx,
            &NewVariant {
                source: "cbb",
                source_id: it.id.to_string(),
                date_key,
                suffix,
                translation: it.traducao.clone().unwrap_or_else(|| "Crentes da Bíblia do Brasil".into()),
                title: crate::text::squash_spaces(&decode_entities(it.titulo.as_deref().unwrap_or(""))),
                local: it.local.clone().unwrap_or_default(),
                pdf_url: pdf,
                audio_url: String::new(),
                page_url: format!("https://www.crentesdabiblia.com.br/mensages/{}", it.id),
                paragraphs: parsed.paragraphs,
            },
        )?;
        n += 1;
    }
    tx.commit()?;
    Ok(n)
}

pub const CBB_URL: &str = "https://www.crentesdabiblia.com.br/api/mensagesSite";

// ---------- importação: Tabernáculo da Fé (busca.tabernaculodafe.org.br) ----------

pub const TDF_API: &str = "https://apibusca.tabernaculodafe.org.br/";
pub const TDF_SITE: &str = "https://busca.tabernaculodafe.org.br/";

/// Uma mensagem da lista do site (`messageGetTitles`).
#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct TdfTitle {
    pub title: String,
    #[serde(default)]
    pub place: String,
    pub date: String,
    #[serde(default)]
    pub translation: String,
    pub code: String,
    /// Revisão do texto no site; muda quando eles corrigem a mensagem.
    #[serde(default)]
    pub version: i64,
}

/// Um parágrafo (`messageGetParagraphs`). Cada linha repete os dados da mensagem.
#[derive(Deserialize, Debug, Clone, Default)]
pub struct TdfParagraph {
    pub paragraph: u32,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub place: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub translation: String,
    #[serde(default)]
    pub version: i64,
}

/// "19480304" -> "1948-0304". Dia 00 (só o mês) fica como no código do VGR: "1950-0100" (50-0100).
pub fn tdf_date(d: &str) -> Option<String> {
    let d = d.trim();
    (d.len() == 8 && d.chars().all(|c| c.is_ascii_digit())).then(|| format!("{}-{}", &d[..4], &d[4..]))
}

/// As duas traduções do site são as mesmas do banco local (texto conferido): GO e GVD.
pub fn tdf_translation(t: &str) -> String {
    let f = fold(t);
    if f.contains("tabernaculo") || f.contains("goiania") {
        "GO".into()
    } else if f.contains("voz de deus") {
        "GVD".into()
    } else {
        squash_spaces(t.trim_matches(|c: char| c.is_whitespace() || c == '“' || c == '”' || c == '"'))
    }
}

/// Os títulos do site vêm em maiúsculas: "HEBREUS 2 – 1ª PARTE" -> "Hebreus 2 – 1ª Parte".
pub fn tdf_title(t: &str) -> String {
    let t = squash_spaces(t);
    // "ª" conta como minúscula para o Rust, mas não tem maiúscula: só letras com caixa valem
    if t.chars().any(|c| c.is_lowercase() && c.to_uppercase().next() != Some(c)) {
        return t;
    }
    const SMALL: &[&str] = &[
        "a", "à", "ao", "aos", "as", "às", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os", "ou", "para", "pela", "pelas",
        "pelo", "pelos", "por", "um", "uma",
    ];
    let mut out = String::with_capacity(t.len());
    for (i, w) in t.split(' ').enumerate() {
        if i > 0 {
            out.push(' ');
        }
        let core: String = w.chars().filter(|c| c.is_alphanumeric()).collect();
        let roman = !core.is_empty() && core != "X" && core.chars().all(|c| matches!(c, 'I' | 'V' | 'X'));
        let lower = w.to_lowercase();
        if roman {
            out.push_str(w);
        } else if i > 0 && SMALL.contains(&core.to_lowercase().as_str()) {
            out.push_str(&lower);
        } else {
            // primeira letra (depois de aspas/parênteses) maiúscula
            let mut done = false;
            for c in lower.chars() {
                if !done && c.is_alphabetic() {
                    out.extend(c.to_uppercase());
                    done = true;
                } else {
                    out.push(c);
                }
            }
        }
    }
    out
}

/// Grava uma mensagem do Tabernáculo da Fé. `strict`: o site tem mais de uma mensagem nesta data.
pub fn save_tdf_message(conn: &mut Connection, t: &TdfTitle, paras: &[TdfParagraph], strict: bool) -> Result<bool> {
    let Some(date_key) = tdf_date(&t.date) else { return Ok(false) };
    let tx = conn.transaction()?;
    save_variant_with(
        &tx,
        &NewVariant {
            source: "tdf",
            source_id: t.code.clone(),
            date_key,
            suffix: String::new(),
            translation: tdf_translation(&t.translation),
            title: tdf_title(&t.title),
            local: squash_spaces(&t.place),
            pdf_url: String::new(),
            audio_url: String::new(),
            page_url: TDF_SITE.into(),
            paragraphs: paras.iter().filter(|p| !p.text.trim().is_empty()).map(|p| (p.paragraph, p.text.trim().to_string())).collect(),
        },
        strict,
    )?;
    tx.commit()?;
    Ok(true)
}

// ---------- consultas ----------

#[derive(Serialize)]
pub struct VariantInfo {
    /// Editada pelo operador (preenchido pelo app; o plugin do Holyrics não usa).
    pub edited: bool,
    pub id: i64,
    pub source: String,
    /// Cópia antiga escondida: id da revisão do Tabernáculo da Fé que a substitui.
    pub superseded_by: Option<i64>,
    pub translation: String,
    pub title: String,
    pub local: String,
    pub para_count: i64,
    pub pdf_url: String,
    pub audio_url: String,
    pub page_url: String,
}

#[derive(Serialize)]
pub struct GroupInfo {
    pub id: i64,
    pub code: String,
    pub date_key: String,
    pub year: i64,
    pub title: String,
    pub local: String,
    pub preferred_variant: Option<i64>,
    pub chosen: bool,
    pub variants: Vec<VariantInfo>,
}

fn variants_of(conn: &Connection, gid: i64) -> Result<Vec<VariantInfo>> {
    let mut st = conn.prepare_cached(
        "SELECT id, source, translation, title, local, para_count, pdf_url, audio_url, page_url, superseded_by
         FROM msg_variants WHERE group_id=?1 ORDER BY (para_count>0) DESC, source, translation",
    )?;
    let rows = st.query_map([gid], |r| {
        Ok(VariantInfo {
            edited: false,
            id: r.get(0)?,
            source: r.get(1)?,
            superseded_by: r.get(9)?,
            translation: r.get(2)?,
            title: r.get(3)?,
            local: r.get(4)?,
            para_count: r.get(5)?,
            pdf_url: r.get(6)?,
            audio_url: r.get(7)?,
            page_url: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn group(conn: &Connection, gid: i64) -> Result<GroupInfo> {
    let mut g = conn.query_row(
        "SELECT id, code, date_key, year, title, local, preferred_variant, chosen FROM msg_groups WHERE id=?1",
        [gid],
        |r| {
            Ok(GroupInfo {
                id: r.get(0)?,
                code: r.get(1)?,
                date_key: r.get(2)?,
                year: r.get(3)?,
                title: r.get(4)?,
                local: r.get(5)?,
                preferred_variant: r.get(6)?,
                chosen: r.get::<_, i64>(7)? == 1,
                variants: vec![],
            })
        },
    )?;
    g.variants = variants_of(conn, gid)?;
    Ok(g)
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ListQuery {
    pub filter: String,
    pub year_from: Option<i64>,
    pub year_to: Option<i64>,
    pub only_with_text: bool,
    pub only_multi: bool,
    pub sort: String,
    pub limit: u32,
    pub offset: u32,
    /// Só estes grupos (vazio = todos).
    pub ids: Vec<i64>,
    /// Coleção: "selos" (as 10 mensagens da série dos Sete Selos) ou "eras" (capítulos do livro das Eras).
    pub collection: String,
}

/// Mensagens da série dos Sete Selos (março de 1963), na ordem.
pub const SELOS_CODES: [&str; 10] = ["63-0317M", "63-0317N", "63-0318", "63-0319", "63-0320", "63-0321", "63-0322", "63-0323", "63-0324M", "63-0324N"];

#[derive(Serialize)]
pub struct GroupRow {
    pub id: i64,
    pub code: String,
    pub date_key: String,
    pub title: String,
    pub local: String,
    pub translations: String,
    pub variant_count: i64,
    pub with_text: i64,
    pub chosen: bool,
}

#[derive(Serialize)]
pub struct GroupList {
    pub total: i64,
    pub rows: Vec<GroupRow>,
}

pub fn list_groups(conn: &Connection, q: &ListQuery) -> Result<GroupList> {
    let r = list_groups_inner(conn, q)?;
    // código com sufixo que não existe (ex.: 65-1127B): mostra as mensagens do dia
    if r.total == 0 {
        if let Some((dk, sfx)) = parse_date(&q.filter) {
            if !sfx.is_empty() {
                return list_groups_inner(conn, &ListQuery { filter: code_for(&dk, ""), ..clone_list(q) });
            }
        }
    }
    Ok(r)
}

fn clone_list(q: &ListQuery) -> ListQuery {
    ListQuery {
        filter: q.filter.clone(),
        year_from: q.year_from,
        year_to: q.year_to,
        only_with_text: q.only_with_text,
        only_multi: q.only_multi,
        sort: q.sort.clone(),
        limit: q.limit,
        offset: q.offset,
        ids: q.ids.clone(),
        collection: q.collection.clone(),
    }
}

/// Mensagens cujo título tem todas estas palavras.
fn groups_by_title(conn: &Connection, ws: &[String], limit: u32) -> Result<Vec<GroupRow>> {
    if ws.is_empty() {
        return Ok(vec![]);
    }
    let filter = ws.join(" ");
    let mut rows = list_groups_inner(conn, &ListQuery { filter, limit: 400, only_with_text: false, ..Default::default() })?.rows;
    // só título (não local)
    rows.retain(|g| {
        let t = fold(&g.title);
        ws.iter().all(|w| t.contains(w.as_str()))
    });
    rows.truncate(limit as usize);
    Ok(rows)
}

/// Palavras que sozinhas não puxam títulos (aparecem em quase todos).
const STOPWORDS: &[&str] = &["a", "o", "e", "as", "os", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "um", "uma", "que", "para", "por", "se", "com", "ao"];

/// Mensagens cujo título casa com a consulta, pelas mesmas regras da busca (resultados diretos).
fn groups_by_query(conn: &Connection, parsed: &search::Parsed, q: &MsgSearch, exp: &dyn search::Expander, limit: u32) -> Result<Vec<GroupRow>> {
    let words: Vec<String> = parsed.groups.iter().flatten().flat_map(|a| a.words()).collect();
    if words.is_empty() || words.iter().all(|w| STOPWORDS.contains(&w.as_str())) {
        return Ok(vec![]);
    }
    let matcher = search::TextMatcher::new(parsed, &q.opts, exp);
    // os mesmos filtros da busca de parágrafos (anos, local, tradução, fonte, só a escolhida)
    let mut wh = vec!["1=1".to_string()];
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    if let Some(y) = q.year_from {
        args.push(Box::new(y));
        wh.push(format!("g.year >= ?{}", args.len()));
    }
    if let Some(y) = q.year_to {
        args.push(Box::new(y));
        wh.push(format!("g.year <= ?{}", args.len()));
    }
    if !q.local.trim().is_empty() {
        args.push(Box::new(format!("%{}%", fold(q.local.trim()))));
        wh.push(format!("v.local_fold LIKE ?{}", args.len()));
    }
    for (col, list) in [("v.translation", &q.translations), ("v.source", &q.sources)] {
        if !list.is_empty() {
            let mut ph = vec![];
            for t in list {
                args.push(Box::new(t.clone()));
                ph.push(format!("?{}", args.len()));
            }
            wh.push(format!("{col} IN ({})", ph.join(",")));
        }
    }
    if q.only_preferred {
        wh.push("(g.preferred_variant IS NULL OR g.preferred_variant = v.id)".into());
    }
    let mut st = conn.prepare(&format!(
        "SELECT v.group_id, v.title FROM msg_variants v JOIN msg_groups g ON g.id = v.group_id WHERE {} ORDER BY g.date_key, g.suffix",
        wh.join(" AND ")
    ))?;
    let mut ids: Vec<i64> = vec![];
    for row in st.query_map(params_from_iter(args.iter()), |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
        let (gid, title) = row?;
        if !ids.contains(&gid) && matcher.matches(&title) {
            ids.push(gid);
            if ids.len() >= limit as usize {
                break;
            }
        }
    }
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let mut rows = list_groups(conn, &ListQuery { ids: ids.clone(), limit: limit.max(1), ..Default::default() })?.rows;
    rows.sort_by_key(|g| ids.iter().position(|&i| i == g.id).unwrap_or(usize::MAX));
    Ok(rows)
}

#[derive(Serialize)]
pub struct SuggestTerm {
    pub word: String,
    /// Em quantos parágrafos a palavra aparece.
    pub count: i64,
}

/// Continuação de frase: "sete se" -> "sete selos".
#[derive(Serialize)]
pub struct SuggestPair {
    /// A palavra que completa (como aparece no texto, com acento).
    pub word: String,
    /// A frase inteira sugerida ("sete selos").
    pub phrase: String,
    /// Quantas vezes apareceu na amostra de parágrafos lida.
    pub count: i64,
}

#[derive(Serialize)]
pub struct Suggestions {
    pub terms: Vec<SuggestTerm>,
    pub titles: Vec<GroupRow>,
    /// Pares/frases que continuam as palavras já digitadas.
    pub pairs: Vec<SuggestPair>,
}

/// Palavras que vêm depois das últimas palavras digitadas (até 3), começando com `prefix` (pode ser vazio).
/// Lê uma amostra de parágrafos que têm a frase e conta a palavra seguinte.
/// `shown`: as palavras anteriores como o operador digitou (com acento), para mostrar a frase.
fn suggest_pairs(conn: &Connection, prevs: &[String], prefix: &str, shown: &str) -> Result<Vec<SuggestPair>> {
    if prevs.is_empty() {
        return Ok(vec![]);
    }
    // Busca só pela palavra anterior mais rara ("pilar", "sete"): frase com palavra começada curta ("se…")
    // ou com "de" fica lenta (~1 s); a sequência inteira é conferida no texto logo abaixo.
    let mut anchor = prevs[0].clone();
    let mut best = u64::MAX;
    for w in prevs.iter().filter(|w| !STOPWORDS.contains(&w.as_str())) {
        let n: i64 = conn.query_row("SELECT doc FROM msg_fts_vocab WHERE term = ?1", [w], |r| r.get(0)).optional()?.unwrap_or(0);
        if (n as u64) < best {
            best = n as u64;
            anchor = w.clone();
        }
    }
    let fts = format!("\"{anchor}\"");
    let mut st = conn.prepare_cached("SELECT p.text FROM msg_fts JOIN msg_paragraphs p ON p.id = msg_fts.rowid WHERE msg_fts MATCH ?1 LIMIT 800")?;
    let texts: Vec<String> = st.query_map([fts], |r| r.get(0))?.filter_map(|r| r.ok()).collect();
    // dobra cada texto uma vez só (sem acento, minúsculas) e conta a palavra que vem depois da sequência
    let mut counts: std::collections::HashMap<String, i64> = Default::default();
    let k = prevs.len();
    for t in &texts {
        let ft = fold(t);
        let toks: Vec<&str> = ft.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
        for i in 0..toks.len().saturating_sub(k) {
            if toks[i + k].starts_with(prefix) && toks[i..i + k].iter().zip(prevs).all(|(a, b)| *a == b.as_str()) {
                *counts.entry(toks[i + k].to_string()).or_insert(0) += 1;
            }
        }
    }
    let mut v: Vec<(String, i64)> = counts.into_iter().filter(|(f, _)| !STOPWORDS.contains(&f.as_str()) || !prefix.is_empty()).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.truncate(6);
    // forma com acento, como está no texto, só para as palavras escolhidas
    static WORD: Lazy<Regex> = Lazy::new(|| Regex::new(r"[\p{L}\p{N}]+").unwrap());
    let display = |key: &str| -> String {
        for t in &texts {
            if let Some(m) = WORD.find_iter(t).find(|m| fold(m.as_str()) == key) {
                return m.as_str().to_lowercase();
            }
        }
        key.to_string()
    };
    Ok(v.into_iter()
        .map(|(key, count)| {
            let word = display(&key);
            SuggestPair { phrase: format!("{shown} {word}"), word, count }
        })
        .collect())
}

/// Sugestões ao digitar (como o Typeahead do The Table): palavras do índice que começam como a última
/// palavra digitada (as mais usadas primeiro) e títulos que têm todas as palavras.
pub fn suggest(conn: &Connection, input: &str) -> Result<Suggestions> {
    let last = input.rsplit(char::is_whitespace).next().unwrap_or("");
    let special = last.starts_with(['"', '-']) || last.contains([':', '*', '?', '~', '^']);
    let prefix = fold(last);
    let mut terms = vec![];
    // código de data começado ("65-11"): sugere as mensagens daquele mês/dia
    static PARTIAL: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(\d{2}|\d{4})-(\d{0,4})\s*$").unwrap());
    if let Some(c) = PARTIAL.captures(input) {
        let y = if c[1].len() == 2 { format!("19{}", &c[1]) } else { c[1].to_string() };
        let like = format!("{y}-{}%", &c[2]);
        let mut st = conn.prepare_cached("SELECT DISTINCT date_key, suffix FROM msg_groups WHERE date_key LIKE ?1 AND date_key NOT LIKE '%?%' ORDER BY date_key, suffix LIMIT 8")?;
        let keys: Vec<(String, String)> = st.query_map([like], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
        let mut titles = vec![];
        for (dk, sfx) in keys {
            let code = code_for(&dk, &sfx);
            titles.extend(list_groups(conn, &ListQuery { filter: code, limit: 1, ..Default::default() })?.rows);
        }
        return Ok(Suggestions { terms, titles, pairs: vec![] });
    }
    // continuação de frase: até 3 palavras anteriores + a palavra começada (ou nada, se terminou com espaço)
    let pairs = {
        let toks: Vec<&str> = input.split_whitespace().collect();
        let ends_space = input.ends_with(char::is_whitespace);
        let (prev_toks, pre) = if ends_space { (&toks[..], String::new()) } else if toks.len() >= 2 { (&toks[..toks.len() - 1], prefix.clone()) } else { (&toks[..0], String::new()) };
        let mut prevs: Vec<String> = vec![];
        let mut shown: Vec<&str> = vec![];
        for t in prev_toks.iter().rev() {
            let f = fold(t);
            if f.is_empty() || !f.chars().all(char::is_alphanumeric) || prevs.len() == 3 {
                break;
            }
            prevs.insert(0, f);
            shown.insert(0, t);
        }
        let usable = !special && pre.chars().all(char::is_alphanumeric) && !prevs.is_empty() && prevs.iter().any(|w| !STOPWORDS.contains(&w.as_str()));
        if usable { suggest_pairs(conn, &prevs, &pre, &shown.join(" "))? } else { vec![] }
    };
    if !special && prefix.chars().count() >= 1 && prefix.chars().all(char::is_alphanumeric) && !input.ends_with(char::is_whitespace) {
        let mut st = conn.prepare_cached(
            "SELECT term, doc FROM msg_fts_vocab WHERE term >= ?1 AND term < ?2 ORDER BY doc DESC LIMIT 8",
        )?;
        let end = format!("{prefix}\u{10ffff}");
        for r in st.query_map(params![prefix, end], |r| Ok(SuggestTerm { word: r.get(0)?, count: r.get(1)? }))? {
            terms.push(r?);
        }
    }
    let ws: Vec<String> = if parse_date(input.trim()).is_some() { vec![] } else { words(input).into_iter().filter(|w| w.chars().count() > 2).collect() };
    let titles = if parse_date(input.trim()).is_some() {
        list_groups(conn, &ListQuery { filter: input.trim().to_string(), limit: 6, ..Default::default() })?.rows
    } else {
        groups_by_title(conn, &ws, 6)?
    };
    Ok(Suggestions { terms, titles, pairs })
}

/// Código de capítulo do livro das Eras digitado na lista ("ERAS-05", "eras 5").
static ERAS_CODE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)^eras[\s-]*(\d{1,2})$").unwrap());

fn list_groups_inner(conn: &Connection, q: &ListQuery) -> Result<GroupList> {
    let mut wh = vec!["1=1".to_string()];
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    if !q.ids.is_empty() {
        let ids: Vec<String> = q.ids.iter().map(|i| i.to_string()).collect();
        wh.push(format!("g.id IN ({})", ids.join(",")));
    }
    match q.collection.as_str() {
        "selos" => wh.push(format!("g.code IN ({})", SELOS_CODES.iter().map(|c| format!("'{c}'")).collect::<Vec<_>>().join(","))),
        "eras" => wh.push("g.code LIKE 'ERAS-%'".into()),
        _ => {}
    }
    if let Some((dk, sfx)) = parse_date(&q.filter) {
        args.push(Box::new(dk));
        wh.push(format!("g.date_key = ?{}", args.len()));
        if !sfx.is_empty() {
            args.push(Box::new(sfx));
            wh.push(format!("g.suffix = ?{}", args.len()));
        }
    } else if let Some(c) = ERAS_CODE.captures(q.filter.trim()) {
        // capítulo do livro das Eras pelo código ("ERAS-05", "eras 5")
        args.push(Box::new(format!("ERAS-{:0>2}", &c[1])));
        wh.push(format!("g.code = ?{}", args.len()));
    } else {
        for w in words(&q.filter) {
            args.push(Box::new(format!("%{w}%")));
            let i = args.len();
            wh.push(format!(
                "EXISTS (SELECT 1 FROM msg_variants x WHERE x.group_id=g.id AND (x.title_fold LIKE ?{i} OR x.local_fold LIKE ?{i})) "
            ));
        }
    }
    if let Some(y) = q.year_from {
        args.push(Box::new(y));
        wh.push(format!("g.year >= ?{}", args.len()));
    }
    if let Some(y) = q.year_to {
        args.push(Box::new(y));
        wh.push(format!("g.year <= ?{}", args.len()));
    }
    let having = match (q.only_with_text, q.only_multi) {
        (true, true) => "HAVING with_text > 1",
        (true, false) => "HAVING with_text > 0",
        (false, true) => "HAVING count(CASE WHEN v.superseded_by IS NULL THEN v.id END) > 1",
        _ => "",
    };
    let order = match q.sort.as_str() {
        "title" => "g.title COLLATE NOCASE",
        "local" => "g.local COLLATE NOCASE, g.date_key",
        "date_desc" => "g.date_key DESC, g.suffix DESC",
        _ => "g.date_key, g.suffix",
    };
    let base = format!(
        "SELECT g.id, g.code, g.date_key, g.title, g.local,
                group_concat(DISTINCT CASE WHEN v.para_count > 0 AND v.superseded_by IS NULL THEN v.translation END),
                count(CASE WHEN v.superseded_by IS NULL THEN v.id END), sum(v.para_count > 0 AND v.superseded_by IS NULL) AS with_text, g.chosen
         FROM msg_groups g LEFT JOIN msg_variants v ON v.group_id = g.id
         WHERE {} GROUP BY g.id {having}",
        wh.join(" AND ")
    );
    let total: i64 = conn.query_row(&format!("SELECT count(*) FROM ({base})"), params_from_iter(args.iter()), |r| r.get(0))?;
    let limit = if q.limit == 0 { 500 } else { q.limit };
    let mut st = conn.prepare(&format!("{base} ORDER BY {order} LIMIT {limit} OFFSET {}", q.offset))?;
    let rows = st
        .query_map(params_from_iter(args.iter()), |r| {
            Ok(GroupRow {
                id: r.get(0)?,
                code: r.get(1)?,
                date_key: r.get(2)?,
                title: r.get(3)?,
                local: r.get(4)?,
                translations: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                variant_count: r.get(6)?,
                with_text: r.get::<_, Option<i64>>(7)?.unwrap_or(0),
                chosen: r.get::<_, i64>(8)? == 1,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(GroupList { total, rows })
}

#[derive(Serialize)]
pub struct Paragraph {
    pub id: i64,
    pub num: i64,
    pub seq: i64,
    pub text: String,
}

pub fn paragraphs(conn: &Connection, variant_id: i64) -> Result<Vec<Paragraph>> {
    let mut st = conn.prepare_cached("SELECT id, num, seq, text FROM msg_paragraphs WHERE variant_id=?1 ORDER BY seq")?;
    let rows = st.query_map([variant_id], |r| Ok(Paragraph { id: r.get(0)?, num: r.get(1)?, seq: r.get(2)?, text: r.get(3)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn set_preferred(conn: &Connection, gid: i64, variant_id: i64) -> Result<()> {
    let ok: i64 = conn.query_row("SELECT count(*) FROM msg_variants WHERE id=?1 AND group_id=?2", params![variant_id, gid], |r| r.get(0))?;
    if ok == 0 {
        return Err(AppError::msg("tradução não pertence a esta mensagem"));
    }
    conn.execute("UPDATE msg_groups SET preferred_variant=?1, chosen=1 WHERE id=?2", params![variant_id, gid])?;
    Ok(())
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct MsgSearch {
    pub query: String,
    pub opts: QueryOpts,
    pub year_from: Option<i64>,
    pub year_to: Option<i64>,
    pub local: String,
    pub translations: Vec<String>,
    pub sources: Vec<String>,
    /// Só a tradução escolhida de cada mensagem.
    pub only_preferred: bool,
    /// relevance | date | title | local
    pub sort: String,
    /// Uma linha por mensagem (com número de ocorrências).
    pub by_message: bool,
    pub limit: u32,
    pub offset: u32,
}

#[derive(Serialize)]
pub struct MsgHit {
    pub paragraph_id: i64,
    pub num: i64,
    pub seq: i64,
    pub group_id: i64,
    pub variant_id: i64,
    pub code: String,
    pub date_key: String,
    pub title: String,
    pub local: String,
    pub translation: String,
    pub source: String,
    pub marked: String,
    pub hits: i64,
}

#[derive(Serialize)]
pub struct MsgResults {
    pub total: i64,
    pub hits: Vec<MsgHit>,
    pub terms: Vec<String>,
    /// Mensagens achadas pelo código de data ou pelo título.
    pub direct: Vec<GroupRow>,
}

pub fn search_messages(conn: &Connection, vocab: &search::Vocab, q: &MsgSearch) -> Result<MsgResults> {
    let trimmed = q.query.trim();
    let parsed = search::parse(trimmed);
    let positive: Vec<&search::Atom> = parsed.groups.iter().flatten().collect();
    let title_only = !positive.is_empty()
        && positive.iter().all(|a| {
            matches!(a, search::Atom::Word { field: Some(f), .. } | search::Atom::Phrase { field: Some(f), .. } | search::Atom::Near { field: Some(f), .. } if f == "titulo" || f == "title")
        });
    let direct = if trimmed.is_empty() {
        vec![]
    } else if parse_date(trimmed).is_some() {
        list_groups(conn, &ListQuery { filter: trimmed.to_string(), limit: 12, ..Default::default() })?.rows
    } else {
        // títulos que casam com a consulta inteira (modo, OU, XOR, exclusão, frase, variações…)
        groups_by_query(conn, &parsed, q, vocab, if title_only { 200 } else { 8 })?
    };
    // titulo:... procura só nos títulos
    if title_only {
        let total = direct.len() as i64;
        return Ok(MsgResults { total, hits: vec![], terms: vec![], direct });
    }
    let built = if parse_date(trimmed).is_some() { None } else { search::build(&q.query, &q.opts, vocab, &[]) };
    let Some(built) = built else {
        return Ok(MsgResults { total: 0, hits: vec![], terms: vec![], direct });
    };

    let mut wh = vec!["msg_fts MATCH ?1".to_string()];
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(built.fts.clone())];
    if let Some(y) = q.year_from {
        args.push(Box::new(y));
        wh.push(format!("g.year >= ?{}", args.len()));
    }
    if let Some(y) = q.year_to {
        args.push(Box::new(y));
        wh.push(format!("g.year <= ?{}", args.len()));
    }
    if !q.local.trim().is_empty() {
        args.push(Box::new(format!("%{}%", fold(q.local.trim()))));
        wh.push(format!("v.local_fold LIKE ?{}", args.len()));
    }
    for (col, list) in [("v.translation", &q.translations), ("v.source", &q.sources)] {
        if !list.is_empty() {
            let mut ph = vec![];
            for t in list {
                args.push(Box::new(t.clone()));
                ph.push(format!("?{}", args.len()));
            }
            wh.push(format!("{col} IN ({})", ph.join(",")));
        }
    }
    if q.only_preferred {
        wh.push("(g.preferred_variant IS NULL OR g.preferred_variant = v.id)".into());
    }
    // cópia antiga igual à do Tabernáculo da Fé: fora, a não ser que o operador escolha as fontes
    if q.sources.is_empty() {
        wh.push("v.superseded_by IS NULL".into());
    }
    // índice que cobre (id, variant_id, num, seq): ligar o parágrafo à tradução sem ler o texto do disco
    // (palavra comum: 4–5x mais rápido). O banco do plugin do Holyrics pode não ter: aí vai sem ele.
    let covering: bool = conn
        .query_row("SELECT 1 FROM sqlite_master WHERE type='index' AND name='msg_paragraphs_idvar'", [], |_| Ok(()))
        .optional()?
        .is_some();
    let joins = format!(
        "FROM msg_fts JOIN msg_paragraphs p{} ON p.id = msg_fts.rowid
                 JOIN msg_variants v ON v.id = p.variant_id
                 JOIN msg_groups g ON g.id = v.group_id",
        if covering { " INDEXED BY msg_paragraphs_idvar" } else { "" }
    );
    let where_sql = wh.join(" AND ");
    let limit = if q.limit == 0 { 100 } else { q.limit };
    // ordem aplicada fora da subconsulta: só os apelidos das colunas existem ali
    let order_inner = match q.sort.as_str() {
        "date" => "date_key, suffix, seq",
        "title" => "title_fold, seq",
        "local" => "local_fold, date_key, seq",
        _ => "rank",
    };
    // o trecho destacado (snippet) sai depois, só das linhas mostradas: calcular de todas as que batem
    // (dezenas de milhares numa palavra comum) era o que deixava a pesquisa lenta
    let inner = format!(
        "SELECT p.id pid, p.num, p.seq, g.id gid, v.id vid, g.code, g.date_key, v.title, v.local, v.translation, v.source,
                bm25(msg_fts) rank, v.title_fold, v.local_fold, g.suffix
         {joins} WHERE {where_sql}"
    );
    let (count_sql, sql) = if q.by_message {
        let order = match q.sort.as_str() {
            "date" => "date_key, suffix",
            "title" => "title_fold",
            "local" => "local_fold, date_key",
            _ => "n DESC, best",
        };
        // MATERIALIZED: bm25() não pode rodar dentro de um GROUP BY
        (
            format!("WITH h AS MATERIALIZED ({inner}) SELECT count(DISTINCT vid) FROM h"),
            format!(
                "WITH h AS MATERIALIZED ({inner})
                 SELECT pid, num, seq, gid, vid, code, date_key, title, local, translation, source, count(*) n, min(rank) best
                 FROM h GROUP BY vid ORDER BY {order} LIMIT {limit} OFFSET {}",
                q.offset
            ),
        )
    } else {
        (
            format!("SELECT count(*) {joins} WHERE {where_sql}"),
            format!("SELECT pid, num, seq, gid, vid, code, date_key, title, local, translation, source, 1, rank FROM ({inner}) ORDER BY {order_inner} LIMIT {limit} OFFSET {}", q.offset),
        )
    };
    let total: i64 = conn.query_row(&count_sql, params_from_iter(args.iter()), |r| r.get(0))?;
    let mut st = conn.prepare(&sql)?;
    let mut hits: Vec<MsgHit> = st
        .query_map(params_from_iter(args.iter()), |r| {
            Ok(MsgHit {
                paragraph_id: r.get(0)?,
                num: r.get(1)?,
                seq: r.get(2)?,
                group_id: r.get(3)?,
                variant_id: r.get(4)?,
                code: r.get(5)?,
                date_key: r.get(6)?,
                title: r.get(7)?,
                local: r.get(8)?,
                translation: r.get(9)?,
                source: r.get(10)?,
                marked: String::new(),
                hits: r.get(11)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    // trecho destacado só dos parágrafos que vão para a tela
    if !hits.is_empty() {
        let ids: Vec<String> = hits.iter().map(|h| h.paragraph_id.to_string()).collect();
        let mut st = conn.prepare(&format!(
            "SELECT rowid, snippet(msg_fts, 0, '⟦', '⟧', '…', 48) FROM msg_fts WHERE msg_fts MATCH ?1 AND rowid IN ({})",
            ids.join(",")
        ))?;
        let snips: std::collections::HashMap<i64, String> =
            st.query_map([&built.fts], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
        for h in &mut hits {
            if let Some(s) = snips.get(&h.paragraph_id) {
                h.marked = s.clone();
            }
        }
    }
    Ok(MsgResults { total, hits, terms: built.terms, direct })
}

#[derive(Serialize)]
pub struct MsgStats {
    pub groups: i64,
    pub variants: i64,
    pub with_text: i64,
    pub multi: i64,
    pub paragraphs: i64,
    pub by_source: Vec<(String, i64)>,
    pub translations: Vec<(String, i64)>,
    /// Cópias antigas escondidas (mesmo texto do Tabernáculo da Fé).
    pub superseded: i64,
    pub year_min: Option<i64>,
    pub year_max: Option<i64>,
}

pub fn stats(conn: &Connection) -> Result<MsgStats> {
    let one = |sql: &str| -> rusqlite::Result<i64> { conn.query_row(sql, [], |r| r.get(0)) };
    let pairs = |sql: &str| -> Result<Vec<(String, i64)>> {
        let mut st = conn.prepare(sql)?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    };
    Ok(MsgStats {
        groups: one("SELECT count(*) FROM msg_groups")?,
        variants: one("SELECT count(*) FROM msg_variants")?,
        with_text: one("SELECT count(DISTINCT group_id) FROM msg_variants WHERE para_count > 0")?,
        multi: one("SELECT count(*) FROM (SELECT group_id FROM msg_variants WHERE para_count > 0 AND superseded_by IS NULL GROUP BY group_id HAVING count(*) > 1)")?,
        paragraphs: one("SELECT count(*) FROM msg_paragraphs")?,
        by_source: pairs("SELECT source, count(*) FROM msg_variants WHERE para_count > 0 AND superseded_by IS NULL GROUP BY source")?,
        translations: pairs("SELECT translation, count(*) FROM msg_variants WHERE para_count > 0 AND superseded_by IS NULL AND translation <> '' GROUP BY translation ORDER BY 2 DESC")?,
        superseded: one("SELECT count(*) FROM msg_variants WHERE superseded_by IS NOT NULL")?,
        year_min: conn.query_row("SELECT min(year) FROM msg_groups WHERE year > 1900", [], |r| r.get(0))?,
        year_max: conn.query_row("SELECT max(year) FROM msg_groups", [], |r| r.get(0))?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        assert_eq!(parse_date("1958-0309N"), Some(("1958-0309".into(), "N".into())));
        assert_eq!(parse_date("1959-11-23"), Some(("1959-1123".into(), "".into())));
        assert_eq!(parse_date("65-1127B"), Some(("1965-1127".into(), "B".into())));
        assert_eq!(parse_date("27/11/1965"), Some(("1965-1127".into(), "".into())));
        assert_eq!(parse_date("amor"), None);
        assert_eq!(code_for("1958-0309", "N"), "58-0309N");
    }

    #[test]
    fn pdf_text() {
        let t = "A IGREJA IRÁ ANTES DA TRIBULAÇÃO?\n09 de Março de 1958\nJeffersonville – Indiana – E.U.A.\nTradução: Crentes da Bíblia [Chapecó-SC]\n\n1 Vamos inclinar nossas cabeças por um momento, para uma palavra de oração.\n2 Santíssimo e justo Deus, queremos dar-Te graças por Teu cuidado para conosco,\no que para nós é melhor. Permita -nos ver.\nA IGREJA IRÁ ANTES DA TRIBULAÇÃO? 3\n3 Te pedimos que lembres daqueles.\n";
        let p = parse_message(t, false);
        assert_eq!(p.translation.as_deref(), Some("Crentes da Bíblia [Chapecó-SC]"));
        assert_eq!(p.place.as_deref(), Some("Jeffersonville – Indiana – E.U.A."));
        assert_eq!(p.paragraphs.len(), 3);
        assert_eq!(p.paragraphs[1].0, 2);
        assert!(p.paragraphs[1].1.ends_with("o que para nós é melhor. Permita-nos ver."), "{:?}", p.paragraphs[1]);
        assert_eq!(p.paragraphs[2], (3, "Te pedimos que lembres daqueles.".into()));
    }

    #[test]
    fn unnumbered_first_paragraph() {
        let t = "DEUS GUARDA SUA PALAVRA\nWilliam Marrion Branham\n20 de janeiro de 1957\nJeffersonville - Indiana - E.U.A.\n. . .passados. E estou agradecido por aqueles que se esforçaram para cantar\npara mim quando cheguei.\n2 A irmã Angie estava dizendo.\n3 Fim.\n4 Amém.";
        let p = parse_message(t, false);
        assert_eq!(p.paragraphs.len(), 4);
        assert_eq!(p.paragraphs[0].0, 1);
        assert!(p.paragraphs[0].1.starts_with(". . .passados"));
    }

    #[test]
    fn vgr_symbols() {
        let t = "TESTEMUNHAS 1\nTestemunhas\n` Boa noite, amigos. É uma alegria.\nEstamos felizes.\n„ Estou feliz em ter visitantes.\n… E_e o Irmão Tom.\n† Quarto parágrafo.\n";
        let p = parse_message(t, false);
        let nums: Vec<u32> = p.paragraphs.iter().map(|x| x.0).collect();
        assert_eq!(nums, vec![1, 2, 3, 4], "{:?}", p.paragraphs);
        assert_eq!(p.paragraphs[0].1, "Boa noite, amigos. É uma alegria. Estamos felizes.");
        assert_eq!(p.paragraphs[2].1, "E—e o Irmão Tom.");
        assert_eq!(vgr_number("ƒ‚"), Some(10));
    }

    #[test]
    fn cbb_html() {
        let html = "<p>FALE A ESTA MONTANHA</p><p>Speak To This Mountain</p><p>William Marrion Branham</p><p>Segunda-feira, 23 de novembro de 1959</p><p>San Jose, Califórnia – E.U.A.</p><p>Obrigado. Podem se sentar.&nbsp;Peço desculpa.</p><p>2 Então, agora,&nbsp; bem.</p><p>3 Depois dos cultos, centenas de</p><p>2 CRENTES DA BÍBLIA</p><p>bênção… Às vezes.</p><p>4 Agora.</p><p>Fone/Fax: (49) 98405-8057</p><p>Website: www.crentesdabiblia.org</p>";
        let p = parse_message(&html_to_lines(html), true);
        assert_eq!(p.place.as_deref(), Some("San Jose, Califórnia – E.U.A."));
        let nums: Vec<u32> = p.paragraphs.iter().map(|x| x.0).collect();
        assert_eq!(nums, vec![1, 2, 3, 4]);
        assert_eq!(p.paragraphs[2].1, "Depois dos cultos, centenas de bênção… Às vezes.");
    }

    #[test]
    fn groups_merge_translations() {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        let tx = c.transaction().unwrap();
        let mk = |src: &'static str, id: &str, dk: &str, sfx: &str, title: &str| NewVariant {
            source: src,
            source_id: id.into(),
            date_key: dk.into(),
            suffix: sfx.into(),
            translation: src.to_uppercase(),
            title: title.into(),
            local: String::new(),
            pdf_url: String::new(),
            audio_url: String::new(),
            page_url: String::new(),
            paragraphs: vec![(1, "texto de teste sobre a graça".into())],
        };
        save_variant(&tx, &mk("local", "1", "1958-0309", "M", "A Graça Maravilhosa")).unwrap();
        save_variant(&tx, &mk("local", "2", "1958-0309", "N", "A Igreja Irá Antes Da Tribulação?")).unwrap();
        // CBB sem sufixo: vai para o grupo de título parecido
        save_variant(&tx, &mk("cbb", "9", "1958-0309", "", "A IGREJA IRÁ ANTES DA TRIBULAÇÃO")).unwrap();
        tx.commit().unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM msg_groups", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        let g: i64 = c.query_row("SELECT group_id FROM msg_variants WHERE source='cbb'", [], |r| r.get(0)).unwrap();
        let g2: i64 = c.query_row("SELECT group_id FROM msg_variants WHERE source='local' AND source_id='2'", [], |r| r.get(0)).unwrap();
        assert_eq!(g, g2);

        let v = search::Vocab::from_terms(vec![]);
        let r = search_messages(&c, &v, &MsgSearch { query: "graça".into(), ..Default::default() }).unwrap();
        assert_eq!(r.total, 3);
        let r = search_messages(&c, &v, &MsgSearch { query: "graça".into(), only_preferred: true, ..Default::default() }).unwrap();
        assert_eq!(r.total, 2);
        let r = search_messages(&c, &v, &MsgSearch { query: "graça".into(), by_message: true, sort: "date".into(), ..Default::default() }).unwrap();
        assert_eq!(r.total, 3);
        assert_eq!(r.hits.len(), 3);
        assert!(r.hits[0].marked.contains("⟦graça⟧"));
        // todas as ordens funcionam por parágrafo e por mensagem
        for sort in ["relevance", "date", "title", "local"] {
            for by_message in [false, true] {
                let r = search_messages(&c, &v, &MsgSearch { query: "graça".into(), sort: sort.into(), by_message, ..Default::default() });
                assert!(r.is_ok(), "ordem {sort} (por mensagem: {by_message}): {:?}", r.err().map(|e| e.to_string()));
                assert_eq!(r.unwrap().hits.len(), 3);
            }
        }
        // títulos diretos obedecem aos filtros (as mensagens de teste são de 1958)
        let r = search_messages(&c, &v, &MsgSearch { query: "graça".into(), year_from: Some(1960), ..Default::default() }).unwrap();
        assert!(r.direct.is_empty(), "filtro de anos vale nos títulos");
        let r = search_messages(&c, &v, &MsgSearch { query: "graça".into(), year_from: Some(1950), ..Default::default() }).unwrap();
        assert!(!r.direct.is_empty());
        // sugestões ao digitar: palavra do índice e título
        let s = suggest(&c, "a gra").unwrap();
        assert!(s.terms.iter().any(|t| t.word == "graca" && t.count == 3), "{:?}", s.terms.iter().map(|t| &t.word).collect::<Vec<_>>());
        assert!(s.titles.iter().any(|g| g.title.contains("Graça")));
        assert!(suggest(&c, "-gra").unwrap().terms.is_empty(), "exclusão não sugere");
        assert!(suggest(&c, "a g").unwrap().terms.iter().any(|t| t.word == "graca"), "última palavra com 1 letra também sugere");
        let codes: Vec<String> = suggest(&c, "58-03").unwrap().titles.iter().map(|g| g.code.clone()).collect();
        assert!(codes.iter().any(|c| c.starts_with("58-0309")), "código começado sugere as mensagens: {codes:?}");
        // continuação de frase: "teste sobre a gr" -> "teste sobre a graça"
        let s = suggest(&c, "teste sobre a gr").unwrap();
        assert_eq!(s.pairs.first().map(|p| p.phrase.as_str()), Some("teste sobre a graça"), "{:?}", s.pairs.iter().map(|p| &p.phrase).collect::<Vec<_>>());
        let s = suggest(&c, "texto de ").unwrap();
        assert_eq!(s.pairs.first().map(|p| p.word.as_str()), Some("teste"), "palavra que vem depois");
        let r = search_messages(&c, &v, &MsgSearch { query: "58-0309N".into(), ..Default::default() }).unwrap();
        assert_eq!(r.direct.len(), 1);

        // Busca CBB com data só do ano (AAAA-01-01): encaixa pelo título, partes numeradas separadas
        let tx = c.transaction().unwrap();
        save_variant(&tx, &mk("local", "3", "1953-0308", "", "Israel No Mar Vermelho #1")).unwrap();
        save_variant(&tx, &mk("local", "4", "1953-0309", "", "Israel No Mar Vermelho #2")).unwrap();
        save_variant(&tx, &mk("cbb", "13", "1953-0101", "", "Israel no Mar Vermelho 1")).unwrap();
        save_variant(&tx, &mk("cbb", "14", "1953-0101", "", "Israel no Mar Vermelho 2")).unwrap();
        save_variant(&tx, &mk("cbb", "20", "1953-0101", "", "A coluna de fogo")).unwrap();
        save_variant(&tx, &mk("cbb", "21", "1953-0101", "", "Demonologia 1 Estado físico")).unwrap();
        tx.commit().unwrap();
        fn g_of(c: &Connection, src: &str, id: &str) -> i64 {
            c.query_row("SELECT group_id FROM msg_variants WHERE source=?1 AND source_id=?2", [src, id], |r| r.get(0)).unwrap()
        }
        assert_eq!(g_of(&c, "cbb", "13"), g_of(&c, "local", "3"));
        assert_eq!(g_of(&c, "cbb", "14"), g_of(&c, "local", "4"));
        assert_ne!(g_of(&c, "cbb", "20"), g_of(&c, "cbb", "21"), "datas só do ano não juntam mensagens diferentes");
        let code: String = c.query_row("SELECT code FROM msg_groups WHERE id=?1", [g_of(&c, "cbb", "20")], |r| r.get(0)).unwrap();
        assert_eq!(code, "53-????");
        tidy_groups(&mut c).unwrap();
        // reimportar não muda nada
        let tx = c.transaction().unwrap();
        save_variant(&tx, &mk("cbb", "13", "1953-0101", "", "Israel no Mar Vermelho 1")).unwrap();
        tx.commit().unwrap();
        assert_eq!(g_of(&c, "cbb", "13"), g_of(&c, "local", "3"));
        let r = search_messages(&c, &v, &MsgSearch { query: "58-0309N".into(), ..Default::default() }).unwrap();
        assert_eq!(r.direct.len(), 1);
    }

    #[test]
    fn tdf_fields() {
        assert_eq!(tdf_date("19480304").as_deref(), Some("1948-0304"));
        assert_eq!(tdf_date("19500100").as_deref(), Some("1950-0100"));
        assert_eq!(code_for("1950-0100", ""), "50-0100");
        assert_eq!(tdf_date("1948"), None);
        assert_eq!(tdf_translation("Tabernáculo da Fé - Goiânia-GO"), "GO");
        assert_eq!(tdf_translation("“Gravações “A Voz de Deus?”"), "GVD");
        assert_eq!(tdf_translation("Outra Tradução"), "Outra Tradução");
        assert_eq!(tdf_title("HEBREUS 2 – 1ª PARTE"), "Hebreus 2 – 1ª Parte");
        assert_eq!(tdf_title("IDE E CHAMAI JESUS!"), "Ide e Chamai Jesus!");
        assert_eq!(tdf_title("O ANJO DE DEUS"), "O Anjo de Deus");
        assert_eq!(tdf_title("A ADOÇÃO III"), "A Adoção III");
        assert_eq!(tdf_title("“O QUE É O ESPÍRITO SANTO?”"), "“O Que É o Espírito Santo?”");
        assert_eq!(tdf_title("Já em minúsculas"), "Já em minúsculas");
        // partes numeradas por ordinal e título contido no outro
        assert!(title_similarity("HEBREUS 6 – 2ª PARTE", "Hebreus, Capítulo 6 #2") >= 0.4);
        assert_eq!(title_similarity("HEBREUS 6 – 2ª PARTE", "Hebreus, Capítulo 5 e 6 #1"), 0.0);
        assert!(title_similarity_same_day("EU SEI", "Eu Sei (Mensagem da Páscoa)") >= 0.4);
        assert!(title_similarity("EU SEI", "Eu Sei (Mensagem da Páscoa)") < 0.4, "no ano inteiro (CBB) o título contido não basta");
    }

    #[test]
    fn tdf_merge_and_supersede() {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        let text_a = "Não saia ninguém daqui dizendo que são dez anos para o arrebatamento. Eu não sei; ninguém sabe. Nem mesmo os anjos do céu sabem.";
        let text_b = "Sei que a próxima coisa a acontecer é a restauração dos dons para a Igreja. Temos que unir a Igreja primeiro para que os dons possam vir.";
        let other = "Ninguém deve sair daqui afirmando dez anos até o arrebatamento. Não sei; ninguém sabe, nem os anjos.";
        let mk = |src: &'static str, id: &str, dk: &str, sfx: &str, tr: &str, title: &str, paras: Vec<&str>| NewVariant {
            source: src,
            source_id: id.into(),
            date_key: dk.into(),
            suffix: sfx.into(),
            translation: tr.into(),
            title: title.into(),
            local: String::new(),
            pdf_url: String::new(),
            audio_url: String::new(),
            page_url: String::new(),
            paragraphs: paras.into_iter().enumerate().map(|(i, t)| (i as u32 + 1, t.to_string())).collect(),
        };
        let tx = c.transaction().unwrap();
        // banco local: GO (texto antigo, um parágrafo cortado) e CB (outra tradução)
        let cut: String = text_b.chars().take(70).collect();
        save_variant(&tx, &mk("local", "1", "1948-0304", "", "GO", "O Anjo de Deus", vec![text_a, &cut])).unwrap();
        save_variant(&tx, &mk("local", "2", "1948-0304", "", "CB", "O Anjo de Deus", vec![other])).unwrap();
        // outro dia, uma só mensagem no banco local, com GO
        save_variant(&tx, &mk("local", "3", "1959-0409", "", "GO", "A Crença de Maria", vec!["Maria creu na palavra do anjo e foi bendita entre as mulheres de toda a terra."])).unwrap();
        tx.commit().unwrap();
        let t = |code: &str, date: &str, title: &str| TdfTitle { title: title.into(), place: "Phoenix - Arizona - E.U.A.".into(), date: date.into(), translation: "Tabernáculo da Fé - Goiânia-GO".into(), code: code.into(), version: 1 };
        let p = |ts: &[&str]| ts.iter().enumerate().map(|(i, t)| TdfParagraph { paragraph: i as u32 + 1, text: t.to_string(), ..Default::default() }).collect::<Vec<_>>();
        save_tdf_message(&mut c, &t("WMB1", "19480304", "O ANJO DE DEUS"), &p(&[text_a, text_b]), false).unwrap();
        // data do site junta com outra mensagem que tem a mesma tradução e texto diferente: não junta
        save_tdf_message(&mut c, &t("WMB2", "19590409", "A HISTÓRIA DA MINHA VIDA"), &p(&["Eu nasci numa pequena cabana em Kentucky, filho mais velho de uma família pobre."]), false).unwrap();
        tidy_groups(&mut c).unwrap();
        fn gid(c: &Connection, src: &str, id: &str) -> i64 {
            c.query_row("SELECT group_id FROM msg_variants WHERE source=?1 AND source_id=?2", [src, id], |r| r.get(0)).unwrap()
        }
        assert_eq!(gid(&c, "tdf", "WMB1"), gid(&c, "local", "1"));
        assert_ne!(gid(&c, "tdf", "WMB2"), gid(&c, "local", "3"), "texto diferente na mesma tradução: não é a mesma mensagem");
        let (sup, tdf_id): (Option<i64>, i64) = (
            c.query_row("SELECT superseded_by FROM msg_variants WHERE source='local' AND source_id='1'", [], |r| r.get(0)).unwrap(),
            c.query_row("SELECT id FROM msg_variants WHERE source='tdf' AND source_id='WMB1'", [], |r| r.get(0)).unwrap(),
        );
        assert_eq!(sup, Some(tdf_id), "cópia antiga do GO fica escondida");
        let cb: Option<i64> = c.query_row("SELECT superseded_by FROM msg_variants WHERE source='local' AND source_id='2'", [], |r| r.get(0)).unwrap();
        assert_eq!(cb, None, "outra tradução continua");
        let g = group(&c, gid(&c, "tdf", "WMB1")).unwrap();
        assert_eq!(g.preferred_variant, Some(tdf_id), "padrão passa para a revisão nova");
        assert_eq!(g.title, "O Anjo de Deus");
        let v = search::Vocab::from_terms(vec![]);
        let r = search_messages(&c, &v, &MsgSearch { query: "arrebatamento".into(), ..Default::default() }).unwrap();
        assert_eq!(r.total, 2, "um por tradução (GO do site + CB), sem a cópia antiga");
        let r = search_messages(&c, &v, &MsgSearch { query: "arrebatamento".into(), sources: vec!["local".into()], ..Default::default() }).unwrap();
        assert_eq!(r.total, 2, "filtrando pela fonte, a cópia antiga aparece");
        assert_eq!(stats(&c).unwrap().superseded, 1);
        // escolha do operador na cópia antiga passa para a revisão nova
        c.execute("UPDATE msg_groups SET preferred_variant=(SELECT id FROM msg_variants WHERE source='local' AND source_id='1'), chosen=1", []).unwrap();
        tidy_groups(&mut c).unwrap();
        assert_eq!(group(&c, gid(&c, "tdf", "WMB1")).unwrap().preferred_variant, Some(tdf_id));
        // duas mensagens do site no mesmo dia e um só grupo local: só junta por título
        let tx = c.transaction().unwrap();
        save_variant(&tx, &mk("local", "5", "1953-0405", "", "CB", "Testemunhas", vec!["texto um"])).unwrap();
        tx.commit().unwrap();
        save_tdf_message(&mut c, &t("WMB5", "19530405", "IDE E DIZEI AOS MEUS DISCÍPULOS"), &p(&["texto dois"]), true).unwrap();
        save_tdf_message(&mut c, &t("WMB6", "19530405", "TESTEMUNHAS"), &p(&["texto três"]), true).unwrap();
        assert_ne!(gid(&c, "tdf", "WMB5"), gid(&c, "local", "5"));
        assert_eq!(gid(&c, "tdf", "WMB6"), gid(&c, "local", "5"));

        // dia com um grupo só de título (em inglês, sem texto) e outro com texto: o que não casou pelo título vai para o vazio
        let tx = c.transaction().unwrap();
        save_variant(&tx, &mk("local", "7", "1954-1219", "M", "", "Divine Healing", vec![])).unwrap();
        save_variant(&tx, &mk("local", "8", "1954-1219", "N", "CB", "Atos do Espírito Santo", vec!["texto quatro"])).unwrap();
        tx.commit().unwrap();
        save_tdf_message(&mut c, &t("WMB7", "19541219", "CURA DIVINA"), &p(&["cura divina"]), true).unwrap();
        save_tdf_message(&mut c, &t("WMB8", "19541219", "ATOS DO ESPÍRITO SANTO"), &p(&["atos"]), true).unwrap();
        assert_eq!(gid(&c, "tdf", "WMB7"), gid(&c, "local", "7"));
        assert_eq!(gid(&c, "tdf", "WMB8"), gid(&c, "local", "8"));
        // baixar de novo não tira do lugar
        save_tdf_message(&mut c, &t("WMB7", "19541219", "CURA DIVINA"), &p(&["cura divina"]), true).unwrap();
        assert_eq!(gid(&c, "tdf", "WMB7"), gid(&c, "local", "7"));

        // cópia da mesma sigla com quase nada (página de rosto): escondida
        let tx = c.transaction().unwrap();
        save_variant(&tx, &mk("local", "9", "1959-0628", "M", "GO", "Uma Igreja Enganada pelo Mundo", vec!["Esta tradução foi impressa e distribuída."])).unwrap();
        tx.commit().unwrap();
        let ten: Vec<String> = (1..=10).map(|i| format!("parágrafo {i} da mensagem sobre a igreja enganada")).collect();
        let ten_ref: Vec<&str> = ten.iter().map(|x| x.as_str()).collect();
        save_tdf_message(&mut c, &t("WMB9", "19590628", "UMA IGREJA ENGANADA PELO MUNDO"), &p(&ten_ref), false).unwrap();
        tidy_groups(&mut c).unwrap();
        let sup: Option<i64> = c.query_row("SELECT superseded_by FROM msg_variants WHERE source='local' AND source_id='9'", [], |r| r.get(0)).unwrap();
        assert!(sup.is_some(), "cópia de 1 § da mesma sigla fica escondida");
    }
}

#[cfg(test)]
mod real_data {
    use super::*;

    /// cargo test --lib real_local -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_local() {
        let src = std::path::Path::new(r"C:\Users\Isaac\Documents\Claude\AVDP\AVDP Busca\database-mensagens\mensagens.db");
        let tmp = std::env::temp_dir().join("avdp_real_test.db");
        let _ = std::fs::remove_file(&tmp);
        let mut c = crate::db::open(&tmp).unwrap();
        let t = std::time::Instant::now();
        let rep = import_local_db(&mut c, src).unwrap();
        println!("import: read={} with_text={} paragraphs={} groups={} em {:?}", rep.read, rep.with_text, rep.paragraphs, rep.groups, t.elapsed());
        // numeração sequencial?
        let mut st = c.prepare("SELECT v.id, v.title FROM msg_variants v WHERE para_count > 0").unwrap();
        let vs: Vec<(i64, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect();
        drop(st);
        let mut bad = 0;
        let mut few = 0;
        for (vid, title) in &vs {
            let ps = paragraphs(&c, *vid).unwrap();
            let gaps = ps.windows(2).filter(|w| w[1].num != w[0].num + 1).count();
            if ps.len() < 15 { few += 1; println!("POUCOS {} {} paras", title, ps.len()); }
            if gaps > 2 { bad += 1; if bad <= 8 { println!("GAPS {} {} gaps/{} paras", title, gaps, ps.len()); } }
        }
        println!("variantes com texto={} com saltos={} com poucos={}", vs.len(), bad, few);
        let s = stats(&c).unwrap();
        println!("stats groups={} with_text={} multi={} paragraphs={} years={:?}-{:?}", s.groups, s.with_text, s.multi, s.paragraphs, s.year_min, s.year_max);
        println!("traduções: {:?}", s.translations);
        let v = {
            let mut st = c.prepare("SELECT term FROM msg_fts_vocab").unwrap();
            crate::search::Vocab::from_terms(st.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect())
        };
        println!("vocab={}", v.len());
        let t = std::time::Instant::now();
        let r = search_messages(&c, &v, &MsgSearch { query: "sétimo selo".into(), opts: QueryOpts { mode: crate::search::Mode::Exact, ..Default::default() }, ..Default::default() }).unwrap();
        println!("\"sétimo selo\" total={} em {:?}", r.total, t.elapsed());
        for h in r.hits.iter().take(3) { println!("  {} {} §{} {}", h.code, h.title, h.num, h.marked); }
        let r = search_messages(&c, &v, &MsgSearch { query: "pilar de fogo".into(), opts: QueryOpts { mode: crate::search::Mode::Near, near: 4, variants: true, ..Default::default() }, by_message: true, ..Default::default() }).unwrap();
        println!("near pilar fogo por mensagem total={}", r.total);
        for h in r.hits.iter().take(3) { println!("  {} {} hits={} {}", h.code, h.title, h.hits, h.marked); }
        // amostra do Busca CBB (2 mensagens salvas da API)
        let sample = std::env::temp_dir().join("claude").join("C--Users-Isaac-Documents-Claude-AVDP").join("2f34f4c9-626d-4122-aa15-2977c1175ead").join("scratchpad").join("web").join("cbb-sample.json");
        if let Ok(js) = std::fs::read_to_string(&sample) {
            let page: CbbPage = serde_json::from_str(&js).unwrap();
            let n = save_cbb_items(&mut c, &page.data).unwrap();
            println!("CBB salvas={n}");
            let mut st = c
                .prepare("SELECT v.id, v.title, g.code, (SELECT count(*) FROM msg_variants x WHERE x.group_id=g.id) FROM msg_variants v JOIN msg_groups g ON g.id=v.group_id WHERE v.source='cbb'")
                .unwrap();
            let rows: Vec<(i64, String, String, i64)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(|r| r.unwrap()).collect();
            for (vid, t, code, nv) in rows {
                let ps = paragraphs(&c, vid).unwrap();
                println!("CBB {code} {t} variantes_no_grupo={nv} paras={} ultimo={:?}", ps.len(), ps.last().map(|p| (p.num, p.text.chars().take(80).collect::<String>())));
                for p in ps.iter().take(3) {
                    println!("    [{}] {}", p.num, p.text.chars().take(120).collect::<String>());
                }
            }
        } else {
            println!("sem amostra CBB em {}", sample.display());
        }
        let ps = paragraphs(&c, vs[100].0).unwrap();
        println!("AMOSTRA {}:", vs[100].1);
        for p in ps.iter().take(4) { println!("  [{}] {}", p.num, p.text.chars().take(220).collect::<String>()); }
    }
}
