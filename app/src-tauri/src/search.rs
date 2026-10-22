//! Consulta no estilo do The Table, traduzida para FTS5.
//!
//! Modos: todas as palavras, qualquer palavra, frase exata, proximidade.
//! Sintaxe aceita em qualquer modo: "frase", -excluir, OU/OR/|, XOR (só uma das duas), prefixo*,
//! curinga no meio (pro?eta, ser*ente), aproximado~, peso^2, campo:termo (ex.: titulo:graça). Opções: palavra inteira (sem prefixo automático),
//! variações (mesmo radical, stemmer português) e aproximada (erros de digitação).

use crate::text::{fold, words};
use rust_stemmers::{Algorithm, Stemmer};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    All,
    Any,
    Exact,
    Near,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct QueryOpts {
    pub mode: Mode,
    /// Sem prefixo automático: "amor" não acha "amoroso".
    pub whole_word: bool,
    /// Inclui palavras com o mesmo radical (amor, amores, amar...).
    pub variants: bool,
    /// Inclui palavras parecidas (erros de digitação).
    pub fuzzy: bool,
    /// Distância máxima em palavras no modo proximidade.
    pub near: u32,
}

impl Default for QueryOpts {
    fn default() -> Self {
        Self { mode: Mode::All, whole_word: false, variants: false, fuzzy: false, near: 10 }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Atom {
    /// `pattern`: o texto tem curinga no meio (`?` = uma letra, `*` = várias); `boost`: peso (`^n`, 1 = normal).
    Word { text: String, prefix: bool, fuzzy: bool, field: Option<String>, pattern: bool, boost: u8 },
    Phrase { words: Vec<String>, field: Option<String> },
    /// `"anjo luz"~5`: as palavras a até `dist` palavras umas das outras.
    Near { words: Vec<String>, dist: u32, field: Option<String> },
    /// `(graça OU fé) lei`: parte entre parênteses, avaliada como uma consulta própria.
    Sub(Box<Parsed>),
}

impl Atom {
    pub fn words(&self) -> Vec<String> {
        match self {
            Atom::Word { text, .. } => vec![text.clone()],
            Atom::Phrase { words, .. } | Atom::Near { words, .. } => words.clone(),
            Atom::Sub(p) => p.groups.iter().flatten().flat_map(|a| a.words()).collect(),
        }
    }
}

/// Grupos ligados conforme o modo; dentro de um grupo os átomos são alternativas (OU).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Parsed {
    pub groups: Vec<Vec<Atom>>,
    pub exclude: Vec<Atom>,
    /// Índices dos grupos ligados por XOR (exatamente um dos termos).
    pub xor: Vec<usize>,
}

const FIELD_NAMES: &[&str] = &["titulo", "title", "artista", "artist", "letra", "lyrics", "texto", "text", "local"];

/// Lê a entrada do usuário.
pub fn parse(input: &str) -> Parsed {
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    parse_until(&chars, &mut i, false)
}

/// Lê até o fim (ou até o `)` que fecha, quando `nested`).
fn parse_until(chars: &[char], i: &mut usize, nested: bool) -> Parsed {
    let mut out = Parsed::default();
    let mut pending_or = false;
    let mut pending_xor = false;

    while *i < chars.len() {
        if chars[*i].is_whitespace() {
            *i += 1;
            continue;
        }
        if chars[*i] == ')' {
            *i += 1;
            if nested {
                return out;
            }
            continue; // ")" sobrando: ignora
        }
        let mut negate = false;
        if chars[*i] == '-' && *i + 1 < chars.len() && !chars[*i + 1].is_whitespace() {
            negate = true;
            *i += 1;
        }

        // campo:
        let mut field: Option<String> = None;
        {
            let mut j = *i;
            while j < chars.len() && chars[j].is_alphabetic() {
                j += 1;
            }
            if j < chars.len() && chars[j] == ':' && j > *i {
                let name = fold(&chars[*i..j].iter().collect::<String>());
                if FIELD_NAMES.contains(&name.as_str()) {
                    field = Some(name);
                    *i = j + 1;
                }
            }
        }

        let atom = if *i < chars.len() && chars[*i] == '(' {
            // parênteses: consulta própria
            *i += 1;
            let sub = parse_until(chars, i, true);
            if sub.groups.is_empty() {
                None
            } else if sub.groups.len() == 1 && sub.groups[0].len() == 1 && sub.exclude.is_empty() {
                Some(sub.groups[0][0].clone())
            } else {
                Some(Atom::Sub(Box::new(sub)))
            }
        } else if *i < chars.len() && chars[*i] == '"' {
            *i += 1;
            let start = *i;
            while *i < chars.len() && chars[*i] != '"' {
                *i += 1;
            }
            let inner: String = chars[start..*i].iter().collect();
            *i += 1; // fecha aspas
            // "a b"~5: proximidade
            let mut dist: Option<u32> = None;
            if *i < chars.len() && chars[*i] == '~' {
                let s = *i + 1;
                let mut e = s;
                while e < chars.len() && chars[e].is_ascii_digit() {
                    e += 1;
                }
                if e > s {
                    dist = chars[s..e].iter().collect::<String>().parse().ok();
                    *i = e;
                }
            }
            let ws = words(&inner);
            match (ws.len(), dist) {
                (0, _) => None,
                (1, _) => Some(Atom::Word { text: ws[0].clone(), prefix: false, fuzzy: false, field, pattern: false, boost: 1 }),
                (_, Some(d)) => Some(Atom::Near { words: ws, dist: d.max(1), field }),
                _ => Some(Atom::Phrase { words: ws, field }),
            }
        } else {
            let start = *i;
            while *i < chars.len() && !chars[*i].is_whitespace() && !matches!(chars[*i], '"' | '(' | ')') {
                *i += 1;
            }
            let raw: String = chars[start..*i].iter().collect();
            if field.is_none() && !negate && (raw == "OR" || raw == "OU" || raw == "|" || raw == "||") {
                pending_or = true;
                continue;
            }
            if field.is_none() && !negate && raw == "XOR" {
                pending_xor = true;
                continue;
            }
            if field.is_none() && !negate && (raw == "AND" || raw == "&&" || raw == "E") {
                continue;
            }
            let mut core = raw.as_str();
            let mut prefix = false;
            let mut fuzzy = false;
            // peso: graça^3
            let mut boost = 1u8;
            if let Some(pos) = core.rfind('^') {
                if let Ok(n) = core[pos + 1..].parse::<f32>() {
                    boost = n.round().clamp(1.0, 5.0) as u8;
                    core = &core[..pos];
                }
            }
            loop {
                if let Some(s) = core.strip_suffix('*') {
                    prefix = true;
                    core = s;
                } else if let Some(s) = core.strip_suffix('~') {
                    fuzzy = true;
                    core = s;
                } else {
                    break;
                }
            }
            // curinga no meio (pro?eta, ser*ente): vira padrão, expandido pelo vocabulário do índice
            if core.contains(['?', '*']) {
                let pat: String = fold(core).chars().filter(|c| c.is_alphanumeric() || *c == '?' || *c == '*').collect();
                if pat.chars().any(|c| c.is_alphanumeric()) {
                    Some(Atom::Word { text: pat, prefix, fuzzy: false, field, pattern: true, boost })
                } else {
                    None
                }
            } else {
                let ws = words(core);
                match ws.len() {
                    0 => None,
                    1 => Some(Atom::Word { text: ws[0].clone(), prefix, fuzzy, field, pattern: false, boost }),
                    _ => Some(Atom::Phrase { words: ws, field }),
                }
            }
        };

        let Some(atom) = atom else { continue };
        if negate {
            out.exclude.push(atom);
        } else if (pending_or || pending_xor) && !out.groups.is_empty() {
            out.groups.last_mut().unwrap().push(atom);
            let last = out.groups.len() - 1;
            if pending_xor && !out.xor.contains(&last) {
                out.xor.push(last);
            }
        } else {
            out.groups.push(vec![atom]);
        }
        pending_or = false;
        pending_xor = false;
    }
    out
}

/// Fonte de palavras parecidas (vocabulário do índice).
pub trait Expander {
    fn variants(&self, word: &str) -> Vec<String>;
    fn fuzzy(&self, word: &str) -> Vec<String>;
    /// Palavras do índice que casam com o padrão (`?` = uma letra, `*` = várias).
    fn wildcard(&self, _pattern: &str) -> Vec<String> {
        vec![]
    }
    /// Em quantos registros a palavra aparece (0 = não sei).
    fn doc_freq(&self, _word: &str) -> u64 {
        0
    }
    /// Quantos registros o índice tem (0 = não sei).
    fn total_docs(&self) -> u64 {
        0
    }
}

#[cfg(test)]
pub struct NoExpand;
#[cfg(test)]
impl Expander for NoExpand {
    fn variants(&self, _: &str) -> Vec<String> {
        vec![]
    }
    fn fuzzy(&self, _: &str) -> Vec<String> {
        vec![]
    }
}

/// Vocabulário de um índice FTS5, com radicais em português e o nº de registros de cada palavra.
pub struct Vocab {
    terms: Vec<String>,
    by_stem: HashMap<String, Vec<usize>>,
    docs: HashMap<String, u64>,
    total: u64,
}

pub fn stem(word: &str) -> String {
    thread_local! {
        static STEMMER: Stemmer = Stemmer::create(Algorithm::Portuguese);
    }
    STEMMER.with(|s| s.stem(word).into_owned())
}

impl Vocab {
    #[cfg(test)]
    pub fn from_terms(terms: Vec<String>) -> Self {
        Self::from_counts(terms.into_iter().map(|t| (t, 0)).collect(), 0)
    }

    /// `counts`: (palavra, nº de registros); `total`: registros no índice.
    pub fn from_counts(counts: Vec<(String, u64)>, total: u64) -> Self {
        let mut by_stem: HashMap<String, Vec<usize>> = HashMap::new();
        let mut docs = HashMap::new();
        let mut terms = Vec::with_capacity(counts.len());
        for (i, (t, n)) in counts.into_iter().enumerate() {
            if t.chars().any(|c| c.is_alphabetic()) {
                by_stem.entry(stem(&t)).or_default().push(i);
            }
            if n > 0 {
                docs.insert(t.clone(), n);
            }
            terms.push(t);
        }
        Self { terms, by_stem, docs, total }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.terms.len()
    }
}

impl Expander for Vocab {
    fn variants(&self, word: &str) -> Vec<String> {
        let s = stem(word);
        let mut out: Vec<String> = self
            .by_stem
            .get(&s)
            .map(|ix| ix.iter().map(|&i| self.terms[i].clone()).filter(|t| t != word).collect())
            .unwrap_or_default();
        out.truncate(40);
        out
    }

    fn fuzzy(&self, word: &str) -> Vec<String> {
        let n = word.chars().count();
        if n < 3 {
            return vec![];
        }
        let maxd = if n <= 5 { 1 } else { 2 };
        let mut hits: Vec<(usize, &String)> = self
            .terms
            .iter()
            .filter(|t| t.as_str() != word && (t.chars().count() as isize - n as isize).unsigned_abs() <= maxd)
            .filter_map(|t| {
                let d = strsim::levenshtein(word, t);
                (d <= maxd).then_some((d, t))
            })
            .collect();
        hits.sort_by_key(|(d, _)| *d);
        hits.into_iter().take(20).map(|(_, t)| t.clone()).collect()
    }

    fn wildcard(&self, pattern: &str) -> Vec<String> {
        let Some(re) = wildcard_regex(pattern) else { return vec![] };
        self.terms.iter().filter(|t| re.is_match(t)).take(80).cloned().collect()
    }

    fn doc_freq(&self, word: &str) -> u64 {
        self.docs.get(word).copied().unwrap_or(0)
    }

    fn total_docs(&self) -> u64 {
        self.total
    }
}

fn wildcard_regex(pattern: &str) -> Option<regex::Regex> {
    let mut re = String::from("^");
    for c in pattern.chars() {
        match c {
            '?' => re.push('.'),
            '*' => re.push_str(".*"),
            c => re.push_str(&regex::escape(&c.to_string())),
        }
    }
    re.push('$');
    regex::Regex::new(&re).ok()
}

/// Repetições de cada forma para que todas pesem parecido no bm25: a forma comum (idf baixo)
/// é repetida até empatar com a mais rara. Sem contagem, todas valem 1.
fn weights(exp: &dyn Expander, forms: &[String]) -> Vec<usize> {
    let total = exp.total_docs() as f64;
    let counts: Vec<f64> = forms.iter().map(|f| exp.doc_freq(f) as f64).collect();
    // formas que não existem no índice (ex.: a palavra digitada errada na aproximada) não entram na conta
    if forms.len() < 2 || total <= 0.0 || counts.iter().filter(|&&n| n > 0.0).count() < 2 {
        return vec![1; forms.len()];
    }
    let idf: Vec<Option<f64>> = counts.iter().map(|&n| (n > 0.0).then(|| ((total - n + 0.5) / (n + 0.5)).ln().max(0.05))).collect();
    let max = idf.iter().flatten().cloned().fold(0.0, f64::max);
    idf.iter().map(|v| v.map_or(1, |v| ((max / v).round() as usize).clamp(1, 5))).collect()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Built {
    /// Expressão para `MATCH`.
    pub fts: String,
    /// Palavras procuradas (para destacar no cliente).
    pub terms: Vec<String>,
}

fn quote(w: &str) -> String {
    format!("\"{}\"", w.replace('"', ""))
}

/// Monta a expressão FTS5 (recursiva por causa dos parênteses).
struct Builder<'a> {
    opts: &'a QueryOpts,
    exp: &'a dyn Expander,
    fields: &'a [(&'a str, &'a str)],
}

impl Builder<'_> {
    fn column(&self, f: &Option<String>) -> Option<String> {
        f.as_ref().and_then(|f| self.fields.iter().find(|(k, _)| k == f).map(|(_, c)| c.to_string()))
    }

    /// Alternativas com peso: "a" repetido k vezes = (a AND a AND …).
    fn weighted(&self, forms: &[String], quoted: Vec<String>) -> String {
        let w = weights(self.exp, forms);
        let parts: Vec<String> = quoted
            .into_iter()
            .zip(w)
            .map(|(q, k)| if k > 1 { format!("({})", vec![q; k].join(" AND ")) } else { q })
            .collect();
        if parts.len() == 1 { parts[0].clone() } else { format!("({})", parts.join(" OR ")) }
    }

    fn atom(&self, a: &Atom, terms: &mut Vec<String>, allow_expand: bool) -> String {
        let (expr, field) = match a {
            Atom::Word { text, field, pattern: true, .. } => {
                let found = self.exp.wildcard(text);
                terms.extend(found.iter().cloned());
                let e = match found.len() {
                    // nada casa: termo que não existe, para não virar busca aberta
                    0 => quote("semresultadoqzx"),
                    _ => self.weighted(&found, found.iter().map(|w| quote(w)).collect()),
                };
                (e, field)
            }
            Atom::Word { text, prefix, fuzzy, field, .. } => {
                let base_prefix = *prefix || !self.opts.whole_word;
                let mut forms = vec![text.clone()];
                let mut alts = vec![if base_prefix { format!("{}*", quote(text)) } else { quote(text) }];
                terms.push(text.clone());
                if allow_expand && !*prefix {
                    let mut extra = vec![];
                    if self.opts.variants {
                        extra.extend(self.exp.variants(text));
                    }
                    if *fuzzy || (self.opts.fuzzy && text.chars().count() >= 4) {
                        extra.extend(self.exp.fuzzy(text));
                    }
                    for v in extra {
                        if !forms.contains(&v) {
                            alts.push(quote(&v));
                            terms.push(v.clone());
                            forms.push(v);
                        }
                    }
                }
                // a palavra com prefixo automático não tem contagem: só as formas expandidas ganham peso
                let e = if base_prefix || forms.len() == 1 { if alts.len() == 1 { alts.remove(0) } else { format!("({})", alts.join(" OR ")) } } else { self.weighted(&forms, alts) };
                (e, field)
            }
            Atom::Phrase { words, field } => {
                terms.extend(words.iter().cloned());
                (quote(&words.join(" ")), field)
            }
            Atom::Near { words, dist, field } => {
                terms.extend(words.iter().cloned());
                let parts: Vec<String> = words.iter().map(|w| quote(w)).collect();
                (format!("NEAR({}, {})", parts.join(" "), dist), field)
            }
            Atom::Sub(p) => return format!("({})", self.parsed(p, terms)),
        };
        let expr = match self.column(field) {
            Some(c) => format!("{{{c}}} : {expr}"),
            None => expr,
        };
        // peso: o termo repetido conta mais no bm25 (graça^3 = graça AND graça AND graça)
        match a {
            Atom::Word { boost, .. } if *boost > 1 => format!("({})", vec![expr; *boost as usize].join(" AND ")),
            _ => expr,
        }
    }

    /// Grupos ligados por E (todas) ou OU (qualquer), com XOR e exclusões.
    fn parsed(&self, p: &Parsed, terms: &mut Vec<String>) -> String {
        let parts: Vec<String> = p
            .groups
            .iter()
            .enumerate()
            .map(|(gi, g)| {
                let alts: Vec<String> = g.iter().map(|a| self.atom(a, terms, true)).collect();
                if alts.len() == 1 {
                    alts[0].clone()
                } else if p.xor.contains(&gi) {
                    // XOR: pelo menos um, mas não dois ao mesmo tempo
                    let mut pairs = vec![];
                    for i in 0..alts.len() {
                        for j in i + 1..alts.len() {
                            pairs.push(format!("({} AND {})", alts[i], alts[j]));
                        }
                    }
                    format!("(({}) NOT ({}))", alts.join(" OR "), pairs.join(" OR "))
                } else {
                    format!("({})", alts.join(" OR "))
                }
            })
            .collect();
        let joiner = if self.opts.mode == Mode::Any { " OR " } else { " AND " };
        let mut out = parts.join(joiner);
        if !p.exclude.is_empty() {
            let mut dummy = Vec::new();
            let ex: Vec<String> = p.exclude.iter().map(|a| self.atom(a, &mut dummy, false)).collect();
            out = format!("({out}) NOT ({})", ex.join(" OR "));
        }
        out
    }
}

/// Monta a expressão FTS5. `fields` mapeia nome digitado -> coluna (vazio = ignora campos).
pub fn build(input: &str, opts: &QueryOpts, exp: &dyn Expander, fields: &[(&str, &str)]) -> Option<Built> {
    let parsed = parse(input);
    if parsed.groups.is_empty() {
        return None;
    }
    let mut terms: Vec<String> = Vec::new();
    let b = Builder { opts, exp, fields };

    let fts = match opts.mode {
        Mode::All | Mode::Any => {
            let mut top = parsed.clone();
            let ex = std::mem::take(&mut top.exclude);
            let positive = b.parsed(&top, &mut terms);
            let mut fts = format!("({positive})");
            if !ex.is_empty() {
                let mut dummy = Vec::new();
                let e: Vec<String> = ex.iter().map(|a| b.atom(a, &mut dummy, false)).collect();
                fts = format!("{fts} NOT ({})", e.join(" OR "));
            }
            fts
        }
        Mode::Exact | Mode::Near => {
            let positive = if opts.mode == Mode::Exact {
                let ws: Vec<String> = parsed.groups.iter().flatten().flat_map(|a| a.words()).collect();
                terms.extend(ws.iter().cloned());
                let p = quote(&ws.join(" "));
                if opts.whole_word { p } else { format!("{p}*") }
            } else {
                let atoms: Vec<&Atom> = parsed.groups.iter().flatten().collect();
                let parts: Vec<String> = atoms
                    .iter()
                    .flat_map(|a| match a {
                        Atom::Word { text, prefix, .. } => {
                            terms.push(text.clone());
                            vec![if *prefix || !opts.whole_word { format!("{}*", quote(text)) } else { quote(text) }]
                        }
                        Atom::Phrase { words, .. } => {
                            terms.extend(words.iter().cloned());
                            vec![quote(&words.join(" "))]
                        }
                        other => {
                            let ws = other.words();
                            terms.extend(ws.iter().cloned());
                            ws.iter().map(|w| quote(w)).collect()
                        }
                    })
                    .collect();
                if parts.len() == 1 { parts[0].clone() } else { format!("NEAR({}, {})", parts.join(" "), opts.near.max(1)) }
            };
            let mut fts = format!("({positive})");
            if !parsed.exclude.is_empty() {
                let mut dummy = Vec::new();
                let ex: Vec<String> = parsed.exclude.iter().map(|a| b.atom(a, &mut dummy, false)).collect();
                fts = format!("{fts} NOT ({})", ex.join(" OR "));
            }
            fts
        }
    };
    terms.sort();
    terms.dedup();
    Some(Built { fts, terms })
}

/// Avalia a consulta num texto curto (título): mesmas regras da busca — modo, OU, XOR, exclusão,
/// frase, proximidade, parênteses, curinga, variações e aproximada. Campos são ignorados.
/// As expansões (variações, aproximada, curinga) são calculadas uma vez na criação.
pub struct TextMatcher<'a> {
    parsed: &'a Parsed,
    opts: &'a QueryOpts,
    expansions: HashMap<String, Vec<String>>,
    patterns: HashMap<String, Option<regex::Regex>>,
}

impl<'a> TextMatcher<'a> {
    pub fn new(parsed: &'a Parsed, opts: &'a QueryOpts, exp: &dyn Expander) -> Self {
        let mut m = TextMatcher { parsed, opts, expansions: HashMap::new(), patterns: HashMap::new() };
        m.prepare(parsed, exp);
        m
    }

    fn prepare(&mut self, p: &Parsed, exp: &dyn Expander) {
        for a in p.groups.iter().flatten().chain(p.exclude.iter()) {
            match a {
                Atom::Word { text, pattern: true, .. } => {
                    self.patterns.entry(text.clone()).or_insert_with(|| wildcard_regex(text));
                }
                Atom::Word { text, prefix: false, fuzzy, .. } => {
                    if !self.expansions.contains_key(text) {
                        let mut alts = vec![];
                        if self.opts.variants {
                            alts.extend(exp.variants(text));
                        }
                        if *fuzzy || (self.opts.fuzzy && text.chars().count() >= 4) {
                            alts.extend(exp.fuzzy(text));
                        }
                        self.expansions.insert(text.clone(), alts);
                    }
                }
                Atom::Sub(sub) => self.prepare(sub, exp),
                _ => {}
            }
        }
    }

    pub fn matches(&self, text: &str) -> bool {
        let ws = words(text);
        let p = self.parsed;
        if p.groups.is_empty() {
            return false;
        }
        let positive = match self.opts.mode {
            Mode::Exact => {
                let q: Vec<String> = p.groups.iter().flatten().flat_map(|a| a.words()).collect();
                seq_at(&ws, &q, !self.opts.whole_word).is_some()
            }
            Mode::Near => {
                let q: Vec<String> = p.groups.iter().flatten().flat_map(|a| a.words()).collect();
                near_ok(&ws, &q, self.opts.near.max(1) as usize, !self.opts.whole_word)
            }
            _ => self.eval_parsed(p, &ws),
        };
        positive && !p.exclude.iter().any(|a| self.eval_atom(a, &ws, false))
    }

    fn eval_parsed(&self, p: &Parsed, ws: &[String]) -> bool {
        let group_ok = |gi: usize, g: &Vec<Atom>| -> bool {
            let n = g.iter().filter(|a| self.eval_atom(a, ws, true)).count();
            if p.xor.contains(&gi) { n == 1 } else { n > 0 }
        };
        let pos = if self.opts.mode == Mode::Any {
            p.groups.iter().enumerate().any(|(gi, g)| group_ok(gi, g))
        } else {
            p.groups.iter().enumerate().all(|(gi, g)| group_ok(gi, g))
        };
        pos && !p.exclude.iter().any(|a| self.eval_atom(a, ws, false))
    }

    fn eval_atom(&self, a: &Atom, ws: &[String], allow_expand: bool) -> bool {
        match a {
            Atom::Word { text, pattern: true, .. } => self.patterns.get(text).and_then(|r| r.as_ref()).is_some_and(|re| ws.iter().any(|w| re.is_match(w))),
            Atom::Word { text, prefix, .. } => {
                let pre = *prefix || !self.opts.whole_word;
                if ws.iter().any(|w| word_hit(w, text, pre)) {
                    return true;
                }
                allow_expand && !*prefix && self.expansions.get(text).is_some_and(|alts| alts.iter().any(|v| ws.iter().any(|w| w == v)))
            }
            Atom::Phrase { words: q, .. } => seq_at(ws, q, false).is_some(),
            Atom::Near { words: q, dist, .. } => near_ok(ws, q, *dist as usize, false),
            Atom::Sub(p) => self.eval_parsed(p, ws),
        }
    }
}

fn word_hit(w: &str, target: &str, prefix: bool) -> bool {
    w == target || (prefix && w.starts_with(target))
}

fn seq_at(ws: &[String], q: &[String], last_prefix: bool) -> Option<usize> {
    if q.is_empty() || q.len() > ws.len() {
        return None;
    }
    (0..=ws.len() - q.len()).find(|&s| q.iter().enumerate().all(|(k, x)| word_hit(&ws[s + k], x, last_prefix && k == q.len() - 1)))
}

/// Todas as palavras a até `dist` palavras de distância (como o NEAR do FTS5).
fn near_ok(ws: &[String], q: &[String], dist: usize, prefix: bool) -> bool {
    let pos: Vec<Vec<usize>> = q.iter().map(|x| ws.iter().enumerate().filter(|(_, w)| word_hit(w, x, prefix)).map(|(i, _)| i).collect()).collect();
    if pos.iter().any(|p| p.is_empty()) {
        return false;
    }
    let span = dist + q.len() - 1;
    pos[0].iter().any(|&a| pos.iter().all(|p| p.iter().any(|&b| a.abs_diff(b) <= span)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn opts(mode: Mode) -> QueryOpts {
        QueryOpts { mode, ..Default::default() }
    }

    #[test]
    fn parse_syntax() {
        let p = parse(r#"amor "graça de Deus" -lei fé* OU esperança~ titulo:Jesus"#);
        assert_eq!(p.groups.len(), 4);
        assert_eq!(p.exclude, vec![Atom::Word { text: "lei".into(), prefix: false, fuzzy: false, field: None, pattern: false, boost: 1 }]);
        assert_eq!(p.groups[2].len(), 2, "fé* OU esperança~ vira um grupo");
        assert_eq!(p.groups[3][0], Atom::Word { text: "jesus".into(), prefix: false, fuzzy: false, field: Some("titulo".into()), pattern: false, boost: 1 });
        // XOR, peso e curinga no meio
        let p = parse("fé XOR obras graça^3 pro?eta");
        assert_eq!(p.groups.len(), 3);
        assert_eq!(p.xor, vec![0]);
        assert_eq!(p.groups[1][0], Atom::Word { text: "graca".into(), prefix: false, fuzzy: false, field: None, pattern: false, boost: 3 });
        assert_eq!(p.groups[2][0], Atom::Word { text: "pro?eta".into(), prefix: false, fuzzy: false, field: None, pattern: true, boost: 1 });
    }

    #[test]
    fn lowercase_ou_is_a_word() {
        let p = parse("isto ou aquilo");
        assert_eq!(p.groups.len(), 3);
    }

    #[test]
    fn build_modes() {
        let e = NoExpand;
        let mut o = opts(Mode::All);
        o.whole_word = true;
        assert_eq!(build("fé amor", &o, &e, &[]).unwrap().fts, r#"("fe" AND "amor")"#);
        o.mode = Mode::Any;
        assert_eq!(build("fé amor", &o, &e, &[]).unwrap().fts, r#"("fe" OR "amor")"#);
        o.mode = Mode::Exact;
        assert_eq!(build("fé e amor", &o, &e, &[]).unwrap().fts, r#"("fe e amor")"#);
        o.mode = Mode::Near;
        o.near = 5;
        assert_eq!(build("fé amor", &o, &e, &[]).unwrap().fts, r#"(NEAR("fe" "amor", 5))"#);
        o.mode = Mode::All;
        o.whole_word = false;
        assert_eq!(build("senh -lei", &o, &e, &[]).unwrap().fts, r#"("senh"*) NOT ("lei"*)"#);
        assert_eq!(
            build("titulo:graça x", &o, &e, &[("titulo", "title")]).unwrap().fts,
            r#"({title} : "graca"* AND "x"*)"#
        );
        assert!(build("-so", &o, &e, &[]).is_none());
    }

    fn sample_db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE VIRTUAL TABLE t USING fts5(title, body, tokenize='unicode61 remove_diacritics 2');
             CREATE VIRTUAL TABLE v USING fts5vocab(t, row);
             INSERT INTO t VALUES ('Graça', 'A graça de Deus é maravilhosa');
             INSERT INTO t VALUES ('Amor', 'O amor de Deus nos amou primeiro e amamos');
             INSERT INTO t VALUES ('Lei', 'A lei e a graça; o profeta falou');
             INSERT INTO t VALUES ('Profecia', 'profetas e profecias da palavra');",
        )
        .unwrap();
        c
    }

    fn run(c: &Connection, q: &str, o: &QueryOpts, exp: &dyn Expander) -> Vec<String> {
        let b = build(q, o, exp, &[("titulo", "title")]).unwrap();
        let mut st = c.prepare("SELECT title FROM t WHERE t MATCH ?1 ORDER BY bm25(t, 5, 1)").unwrap();
        st.query_map([b.fts], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    }

    fn vocab(c: &Connection) -> Vocab {
        let mut st = c.prepare("SELECT term FROM v").unwrap();
        Vocab::from_terms(st.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect())
    }

    #[test]
    fn executes_against_fts5() {
        let c = sample_db();
        let v = vocab(&c);
        let o = opts(Mode::All);
        assert_eq!(run(&c, "graça deus", &o, &v), vec!["Graça"]);
        assert_eq!(run(&c, "graça -lei", &o, &v), vec!["Graça"]);
        assert_eq!(run(&c, "\"lei e a graça\"", &o, &v), vec!["Lei"]);
        assert_eq!(run(&c, "titulo:amor", &o, &v), vec!["Amor"]);

        let mut w = opts(Mode::All);
        w.whole_word = true;
        assert!(run(&c, "prof", &w, &v).is_empty());
        w.variants = true;
        // "profecia" e "profecias" têm o mesmo radical
        assert_eq!(run(&c, "profecia", &w, &v), vec!["Profecia"]);

        let mut f = opts(Mode::All);
        f.whole_word = true;
        f.fuzzy = true;
        assert_eq!(run(&c, "maravilhoza", &f, &v), vec!["Graça"]);

        let mut n = opts(Mode::Near);
        n.near = 2;
        assert_eq!(run(&c, "amor deus", &n, &v), vec!["Amor"]);
        n.near = 1;
        assert!(run(&c, "graça maravilhosa", &n, &v).is_empty());

        // curinga no meio: só as palavras que casam, nunca o prefixo inteiro
        assert_eq!(run(&c, "prof?ta", &w, &v), vec!["Lei"]);
        assert_eq!(run(&c, "prof*s", &w, &v), vec!["Profecia"]);
        assert!(run(&c, "x?z", &w, &v).is_empty());
        // XOR: graça XOR lei = só um dos dois
        assert_eq!(run(&c, "graça XOR lei", &w, &v), vec!["Graça"]);
        // peso: o termo com ^ pesa mais, sem mudar o que é achado
        assert_eq!(run(&c, "graça^3 deus", &w, &v), vec!["Graça"]);
        let mut any = opts(Mode::Any);
        any.whole_word = true;
        assert_eq!(run(&c, "amor^4 graça", &any, &v)[0], "Amor");
    }

    #[test]
    fn near_and_parentheses() {
        let p = parse(r#""anjo luz"~5 (graça OU fé) -lei"#);
        assert_eq!(p.groups[0][0], Atom::Near { words: vec!["anjo".into(), "luz".into()], dist: 5, field: None });
        assert!(matches!(&p.groups[1][0], Atom::Sub(sub) if sub.groups.len() == 1 && sub.groups[0].len() == 2));
        assert_eq!(p.exclude.len(), 1);
        // ")" sobrando e "(" sem fechar não quebram
        assert_eq!(parse("a ) b").groups.len(), 2);
        assert_eq!(parse("(a b").groups.len(), 1);

        let c = sample_db();
        let v = vocab(&c);
        let mut o = opts(Mode::All);
        o.whole_word = true;
        let mut r = run(&c, "(graça OU amor) deus", &o, &v);
        r.sort();
        assert_eq!(r, vec!["Amor", "Graça"]);
        let mut r = run(&c, "(graça -lei) OU profecias", &o, &v);
        r.sort();
        assert_eq!(r, vec!["Graça", "Profecia"]);
        assert_eq!(run(&c, r#""deus amou"~2"#, &o, &v), vec!["Amor"]);
        // aninhados
        let mut r = run(&c, "((graça OU amor) deus) OU profecias", &o, &v);
        r.sort();
        assert_eq!(r, vec!["Amor", "Graça", "Profecia"]);
        assert_eq!(run(&c, "((graça OU amor) -deus)", &o, &v), vec!["Lei"], "\"Lei\" tem graça e não tem deus");
        assert!(run(&c, r#""graça maravilhosa"~1"#, &o, &v).is_empty());
    }

    #[test]
    fn equal_weight_for_expanded_forms() {
        // "prometa" é rara e "profeta" é comum: sem peso, a rara ganharia sempre no bm25
        let v = Vocab::from_counts(vec![("prometa".into(), 20), ("profeta".into(), 7000)], 212_000);
        let w = weights(&v, &["prometa".to_string(), "profeta".to_string()]);
        assert_eq!(w[0], 1);
        assert!(w[1] >= 2, "a forma comum é repetida para empatar: {w:?}");
        // sem contagem (vocabulário antigo): tudo vale 1
        let v0 = Vocab::from_terms(vec!["a".into(), "b".into()]);
        assert_eq!(weights(&v0, &["a".to_string(), "b".to_string()]), vec![1, 1]);
        // a forma digitada errada (sem contagem) não desliga o peso das outras
        let v2 = Vocab::from_counts(vec![("arrebatamento".into(), 312), ("arrebatamentos".into(), 5)], 212_000);
        let w2 = weights(&v2, &["arebatamento".to_string(), "arrebatamento".to_string(), "arrebatamentos".to_string()]);
        assert_eq!(w2[0], 1);
        assert!(w2[1] > w2[2], "{w2:?}");
        let b = build("pro?eta", &opts(Mode::All), &v, &[]).unwrap();
        assert!(b.fts.contains(r#"("profeta" AND "profeta""#), "{}", b.fts);
    }

    #[test]
    fn titles_follow_the_query() {
        let v = NoExpand;
        let mut o = opts(Mode::All);
        o.whole_word = true;
        let m = |q: &str, o: &QueryOpts, t: &str| {
            let p = parse(q);
            TextMatcher::new(&p, o, &v).matches(t)
        };
        assert!(!m("fé XOR obras", &o, "Fé Sem Obras É Morta"));
        assert!(m("fé XOR obras", &o, "A Fé É A Nossa Vitória"));
        assert!(!m("graça -lei", &o, "Lei ou Graça"));
        assert!(m("graça -lei", &o, "A Graça Maravilhosa"));
        assert!(m(r#""sétimo selo""#, &o, "O Sétimo Selo"));
        assert!(!m(r#""sétimo selo""#, &o, "O Sexto Selo e o Sétimo"));
        assert!(m("(selo OU trombeta) sétimo", &o, "A Sétima Trombeta e o Sétimo Selo"));
        assert!(m("pro?eta", &o, "Um Profeta Entre Nós"));
        let mut any = opts(Mode::Any);
        any.whole_word = true;
        assert!(m("graça trombeta", &any, "A Graça Maravilhosa"));
        assert!(!m("graça trombeta", &o, "A Graça Maravilhosa"));
    }
}
