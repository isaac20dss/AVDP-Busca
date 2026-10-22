//! Bíblia: livros (mesma estrutura do Holyrics), referências, consultas e importação.

use crate::db::Result;
use crate::error::AppError;
use crate::search::{self, QueryOpts};
use crate::text::fold;
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// (abreviação Holyrics, nome PT, nome EN, capítulos, grupo, código USFM, número MyBible)
pub const BOOKS: [(&str, &str, &str, u32, &str, &str, u32); 66] = [
    ("Gn", "Gênesis", "Genesis", 50, "pentateuco", "GEN", 10),
    ("Ex", "Êxodo", "Exodus", 40, "pentateuco", "EXO", 20),
    ("Lv", "Levítico", "Leviticus", 27, "pentateuco", "LEV", 30),
    ("Nm", "Números", "Numbers", 36, "pentateuco", "NUM", 40),
    ("Dt", "Deuteronômio", "Deuteronomy", 34, "pentateuco", "DEU", 50),
    ("Js", "Josué", "Joshua", 24, "historicos", "JOS", 60),
    ("Jz", "Juízes", "Judges", 21, "historicos", "JDG", 70),
    ("Rt", "Rute", "Ruth", 4, "historicos", "RUT", 80),
    ("1Sm", "1 Samuel", "1 Samuel", 31, "historicos", "1SA", 90),
    ("2Sm", "2 Samuel", "2 Samuel", 24, "historicos", "2SA", 100),
    ("1Rs", "1 Reis", "1 Kings", 22, "historicos", "1KI", 110),
    ("2Rs", "2 Reis", "2 Kings", 25, "historicos", "2KI", 120),
    ("1Cr", "1 Crônicas", "1 Chronicles", 29, "historicos", "1CH", 130),
    ("2Cr", "2 Crônicas", "2 Chronicles", 36, "historicos", "2CH", 140),
    ("Ed", "Esdras", "Ezra", 10, "historicos", "EZR", 150),
    ("Ne", "Neemias", "Nehemiah", 13, "historicos", "NEH", 160),
    ("Et", "Ester", "Esther", 10, "historicos", "EST", 190),
    ("Jó", "Jó", "Job", 42, "poeticos", "JOB", 220),
    ("Sl", "Salmos", "Psalms", 150, "poeticos", "PSA", 230),
    ("Pv", "Provérbios", "Proverbs", 31, "poeticos", "PRO", 240),
    ("Ec", "Eclesiastes", "Ecclesiastes", 12, "poeticos", "ECC", 250),
    ("Ct", "Cantares", "Song of Solomon", 8, "poeticos", "SNG", 260),
    ("Is", "Isaías", "Isaiah", 66, "profetas", "ISA", 290),
    ("Jr", "Jeremias", "Jeremiah", 52, "profetas", "JER", 300),
    ("Lm", "Lamentações", "Lamentations", 5, "profetas", "LAM", 310),
    ("Ez", "Ezequiel", "Ezekiel", 48, "profetas", "EZK", 330),
    ("Dn", "Daniel", "Daniel", 12, "profetas", "DAN", 340),
    ("Os", "Oséias", "Hosea", 14, "profetas", "HOS", 350),
    ("Jl", "Joel", "Joel", 3, "profetas", "JOL", 360),
    ("Am", "Amós", "Amos", 9, "profetas", "AMO", 370),
    ("Ob", "Obadias", "Obadiah", 1, "profetas", "OBA", 380),
    ("Jn", "Jonas", "Jonah", 4, "profetas", "JON", 390),
    ("Mq", "Miquéias", "Micah", 7, "profetas", "MIC", 400),
    ("Na", "Naum", "Nahum", 3, "profetas", "NAM", 410),
    ("Hc", "Habacuque", "Habakkuk", 3, "profetas", "HAB", 420),
    ("Sf", "Sofonias", "Zephaniah", 3, "profetas", "ZEP", 430),
    ("Ag", "Ageu", "Haggai", 2, "profetas", "HAG", 440),
    ("Zc", "Zacarias", "Zechariah", 14, "profetas", "ZEC", 450),
    ("Ml", "Malaquias", "Malachi", 4, "profetas", "MAL", 460),
    ("Mt", "Mateus", "Matthew", 28, "evangelhos", "MAT", 470),
    ("Mc", "Marcos", "Mark", 16, "evangelhos", "MRK", 480),
    ("Lc", "Lucas", "Luke", 24, "evangelhos", "LUK", 490),
    ("Jo", "João", "John", 21, "evangelhos", "JHN", 500),
    ("At", "Atos", "Acts", 28, "atos", "ACT", 510),
    ("Rm", "Romanos", "Romans", 16, "epistolas", "ROM", 520),
    ("1Co", "1 Coríntios", "1 Corinthians", 16, "epistolas", "1CO", 530),
    ("2Co", "2 Coríntios", "2 Corinthians", 13, "epistolas", "2CO", 540),
    ("Gl", "Gálatas", "Galatians", 6, "epistolas", "GAL", 550),
    ("Ef", "Efésios", "Ephesians", 6, "epistolas", "EPH", 560),
    ("Fp", "Filipenses", "Philippians", 4, "epistolas", "PHP", 570),
    ("Cl", "Colossenses", "Colossians", 4, "epistolas", "COL", 580),
    ("1Ts", "1 Tessalonicenses", "1 Thessalonians", 5, "epistolas", "1TH", 590),
    ("2Ts", "2 Tessalonicenses", "2 Thessalonians", 3, "epistolas", "2TH", 600),
    ("1Tm", "1 Timóteo", "1 Timothy", 6, "epistolas", "1TI", 610),
    ("2Tm", "2 Timóteo", "2 Timothy", 4, "epistolas", "2TI", 620),
    ("Tt", "Tito", "Titus", 3, "epistolas", "TIT", 630),
    ("Fm", "Filemom", "Philemon", 1, "epistolas", "PHM", 640),
    ("Hb", "Hebreus", "Hebrews", 13, "epistolas", "HEB", 650),
    ("Tg", "Tiago", "James", 5, "epistolas", "JAS", 660),
    ("1Pe", "1 Pedro", "1 Peter", 5, "epistolas", "1PE", 670),
    ("2Pe", "2 Pedro", "2 Peter", 3, "epistolas", "2PE", 680),
    ("1Jo", "1 João", "1 John", 5, "epistolas", "1JN", 690),
    ("2Jo", "2 João", "2 John", 1, "epistolas", "2JN", 700),
    ("3Jo", "3 João", "3 John", 1, "epistolas", "3JN", 710),
    ("Jd", "Judas", "Jude", 1, "epistolas", "JUD", 720),
    ("Ap", "Apocalipse", "Revelation", 22, "apocalipse", "REV", 730),
];

/// Apelidos extras (já sem acento e sem espaço) -> número do livro.
const EXTRA_ALIASES: &[(&str, u32)] = &[
    ("gen", 1), ("exo", 2), ("lev", 3), ("num", 4), ("deut", 5), ("jos", 6), ("jui", 7), ("jdg", 7),
    ("1sam", 9), ("2sam", 10), ("1re", 11), ("2re", 12), ("1cro", 13), ("2cro", 14), ("esd", 15),
    ("job", 18), ("sal", 19), ("salmo", 19), ("ps", 19), ("psa", 19), ("prov", 20), ("ecl", 21),
    ("cant", 22), ("cantico", 22), ("canticos", 22), ("canticodoscanticos", 22), ("cantaresdesalomao", 22),
    ("isa", 23), ("jer", 24), ("lam", 25), ("eze", 26), ("ezeq", 26), ("dan", 27), ("ose", 28), ("oseias", 28),
    ("abd", 31), ("miq", 33), ("miqueias", 33), ("hab", 35), ("sof", 36), ("zac", 38), ("mal", 39),
    ("mat", 40), ("mar", 41), ("luc", 42), ("joa", 43), ("jhn", 43), ("ato", 44), ("act", 44), ("rom", 45),
    ("1cor", 46), ("2cor", 47), ("gal", 48), ("efe", 49), ("fil", 50), ("col", 51), ("1tes", 52), ("2tes", 53),
    ("1tim", 54), ("2tim", 55), ("tit", 56), ("filem", 57), ("heb", 58), ("tia", 59), ("jas", 59),
    ("1ped", 60), ("2ped", 61), ("1joa", 62), ("2joa", 63), ("3joa", 64), ("jud", 65), ("apo", 66),
    ("apoc", 66), ("rev", 66), ("revelation", 66),
];

#[derive(Serialize, Clone)]
pub struct BookInfo {
    pub id: u32,
    pub abbrev: &'static str,
    pub name: &'static str,
    pub name_en: &'static str,
    pub chapters: u32,
    pub group: &'static str,
}

pub fn books() -> Vec<BookInfo> {
    BOOKS
        .iter()
        .enumerate()
        .map(|(i, b)| BookInfo { id: i as u32 + 1, abbrev: b.0, name: b.1, name_en: b.2, chapters: b.3, group: b.4 })
        .collect()
}

pub fn book_name(book: u32) -> &'static str {
    BOOKS.get(book.saturating_sub(1) as usize).map(|b| b.1).unwrap_or("?")
}

fn key(s: &str) -> String {
    fold(s).chars().filter(|c| c.is_alphanumeric()).collect()
}

static ALIASES: Lazy<HashMap<String, u32>> = Lazy::new(|| {
    let mut m = HashMap::new();
    for (i, b) in BOOKS.iter().enumerate() {
        let id = i as u32 + 1;
        m.insert(key(b.0), id);
        m.insert(key(b.1), id);
        m.insert(key(b.2), id);
        m.insert(key(b.5), id);
    }
    // "jo" é João (como no Holyrics); Jó com acento é tratado antes de dobrar.
    m.insert("jo".into(), 43);
    for (a, id) in EXTRA_ALIASES {
        m.insert((*a).into(), *id);
    }
    m
});

/// Acha o livro pelo nome/abreviação digitados ("1co", "joão", "apo", "Jó").
pub fn find_book(input: &str) -> Option<u32> {
    let raw = input.trim().trim_end_matches('.').to_lowercase();
    if raw == "jó" || raw == "jó." {
        return Some(18);
    }
    let mut k = key(&raw);
    // "i samuel" / "ii reis" / "iii joão"
    for (roman, n) in [("iii", "3"), ("ii", "2"), ("i", "1")] {
        if let Some(rest) = raw.strip_prefix(roman) {
            if rest.starts_with(' ') {
                k = format!("{n}{}", key(rest));
                break;
            }
        }
    }
    if k.is_empty() {
        return None;
    }
    if let Some(&id) = ALIASES.get(&k) {
        return Some(id);
    }
    // prefixo do nome completo, na ordem canônica
    if k.chars().filter(|c| c.is_alphabetic()).count() >= 2 {
        for (i, b) in BOOKS.iter().enumerate() {
            if key(b.1).starts_with(&k) || key(b.2).starts_with(&k) {
                return Some(i as u32 + 1);
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VerseRef {
    pub book: u32,
    pub chapter: u32,
    pub verse: Option<u32>,
    pub verse_end: Option<u32>,
}

static REF_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\s*([1-3]\s*|i{1,3}\s+)?([^\d\s:.,][^\d:]*?)\.?\s*(\d+)?(?:\s*[:.,\s]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$").unwrap()
});

/// "jo 3 16", "1co13:4-7", "Sl 23", "gn 1.1", "i samuel 3".
pub fn parse_ref(input: &str) -> Option<VerseRef> {
    let caps = REF_RE.captures(input)?;
    let num = caps.get(1).map(|m| m.as_str().trim().to_lowercase());
    let name = caps.get(2)?.as_str().trim();
    let book_input = match num.as_deref() {
        Some("1") | Some("i") => format!("1{name}"),
        Some("2") | Some("ii") => format!("2{name}"),
        Some("3") | Some("iii") => format!("3{name}"),
        _ => name.to_string(),
    };
    let book = find_book(&book_input)?;
    let mut chapter = caps.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(1);
    let mut verse = caps.get(4).and_then(|m| m.as_str().parse().ok());
    let verse_end = caps.get(5).and_then(|m| m.as_str().parse().ok());
    // livro de um capítulo só (Obadias, Filemom, 2 e 3 João, Judas): "jd 5" é o versículo 5
    if BOOKS[book as usize - 1].3 == 1 && caps.get(3).is_some() && verse.is_none() {
        verse = Some(chapter);
        chapter = 1;
    }
    if chapter == 0 || chapter > BOOKS[book as usize - 1].3 {
        return None;
    }
    Some(VerseRef { book, chapter, verse, verse_end })
}

/// ID no formato do Holyrics: BBCCCVVV (o front monta o mesmo id em `holyricsExport.ts`).
#[cfg(test)]
pub fn holyrics_id(book: u32, chapter: u32, verse: u32) -> String {
    format!("{book:02}{chapter:03}{verse:03}")
}

pub fn format_ref(book: u32, chapter: u32, verse: u32, verse_end: Option<u32>) -> String {
    match verse_end {
        Some(e) if e > verse => format!("{} {}:{}-{}", book_name(book), chapter, verse, e),
        _ => format!("{} {}:{}", book_name(book), chapter, verse),
    }
}

// ---------- consultas ----------

#[derive(Serialize)]
pub struct BibleInfo {
    pub id: String,
    pub name: String,
    pub abbrev: String,
    pub language: String,
    pub license: String,
    pub source: String,
    pub verses: i64,
}

pub fn list(conn: &Connection) -> Result<Vec<BibleInfo>> {
    let mut st = conn.prepare(
        "SELECT b.id, b.name, b.abbrev, b.language, b.license, b.source,
                (SELECT count(*) FROM verses v WHERE v.bible_id = b.id)
         FROM bibles b ORDER BY b.sort, b.name",
    )?;
    let rows = st.query_map([], |r| {
        Ok(BibleInfo {
            id: r.get(0)?,
            name: r.get(1)?,
            abbrev: r.get(2)?,
            language: r.get(3)?,
            license: r.get(4)?,
            source: r.get(5)?,
            verses: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[derive(Serialize)]
pub struct ChapterVerse {
    pub verse: u32,
    /// Texto por versão, na ordem pedida (None = versão não tem o versículo).
    pub texts: Vec<Option<String>>,
}

pub fn chapter(conn: &Connection, bibles: &[String], book: u32, chapter: u32) -> Result<Vec<ChapterVerse>> {
    let mut map: std::collections::BTreeMap<u32, Vec<Option<String>>> = Default::default();
    let mut st = conn.prepare_cached("SELECT verse, text FROM verses WHERE bible_id=?1 AND book=?2 AND chapter=?3")?;
    for (i, b) in bibles.iter().enumerate() {
        let rows = st.query_map(params![b, book, chapter], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (v, t) = row?;
            let e = map.entry(v).or_insert_with(|| vec![None; bibles.len()]);
            e[i] = Some(t);
        }
    }
    Ok(map.into_iter().map(|(verse, texts)| ChapterVerse { verse, texts }).collect())
}

/// Quantos capítulos cada livro tem nesta versão (0 = sem texto).
pub fn chapter_counts(conn: &Connection, bible: &str) -> Result<Vec<u32>> {
    let mut out = vec![0u32; 66];
    let mut st = conn.prepare("SELECT book, max(chapter) FROM verses WHERE bible_id=?1 GROUP BY book")?;
    for row in st.query_map([bible], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, u32>(1)?)))? {
        let (b, c) = row?;
        if (1..=66).contains(&b) {
            out[b as usize - 1] = c;
        }
    }
    Ok(out)
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct VerseSearch {
    pub query: String,
    pub opts: QueryOpts,
    pub bible: String,
    /// "all" | "ot" | "nt" | "book"
    pub scope: String,
    pub book: u32,
    pub limit: u32,
    pub offset: u32,
    /// "bible" = ordem dos livros (Gn → Ap); qualquer outro = relevância.
    pub sort: String,
}

#[derive(Serialize)]
pub struct VerseHit {
    pub book: u32,
    pub chapter: u32,
    pub verse: u32,
    pub reference: String,
    pub text: String,
    /// Texto com ⟦ ⟧ em volta dos termos achados.
    pub marked: String,
}

#[derive(Serialize)]
pub struct VerseResults {
    pub total: i64,
    pub hits: Vec<VerseHit>,
    pub terms: Vec<String>,
    /// Referência reconhecida no texto da busca (ex.: "jo 3 16").
    pub reference: Option<VerseRef>,
}

pub fn search(conn: &Connection, vocab: &search::Vocab, q: &VerseSearch) -> Result<VerseResults> {
    let reference = parse_ref(&q.query).filter(|_| q.query.chars().any(|c| c.is_ascii_digit()));
    let Some(built) = search::build(&q.query, &q.opts, vocab, &[]) else {
        return Ok(VerseResults { total: 0, hits: vec![], terms: vec![], reference });
    };
    let scope_sql = match q.scope.as_str() {
        // ?3 aparece em todos os ramos: a consulta sempre recebe os 3 parâmetros.
        // `+v.book` impede o SQLite de varrer o índice por livro (AT levava 1,5 s; assim vai pelo FTS primeiro).
        "ot" => " AND +v.book <= 39 AND ?3 = ?3",
        "nt" => " AND +v.book >= 40 AND ?3 = ?3",
        "book" => " AND v.book = ?3",
        _ => " AND ?3 = ?3",
    };
    let base = format!(
        "FROM verses_fts f JOIN verses v ON v.id = f.rowid
         WHERE verses_fts MATCH ?1 AND v.bible_id = ?2{scope_sql}"
    );
    let total: i64 = conn.query_row(&format!("SELECT count(*) {base}"), params![built.fts, q.bible, q.book], |r| r.get(0))?;
    let limit = if q.limit == 0 { 200 } else { q.limit };
    let order = if q.sort == "bible" { "v.book, v.chapter, v.verse" } else { "bm25(verses_fts), v.book, v.chapter, v.verse" };
    let mut st = conn.prepare(&format!(
        "SELECT v.book, v.chapter, v.verse, v.text, highlight(verses_fts, 0, '⟦', '⟧')
         {base} ORDER BY {order} LIMIT {limit} OFFSET {}",
        q.offset
    ))?;
    let hits = st
        .query_map(params![built.fts, q.bible, q.book], |r| {
            let (book, chapter, verse): (u32, u32, u32) = (r.get(0)?, r.get(1)?, r.get(2)?);
            Ok(VerseHit { book, chapter, verse, reference: format_ref(book, chapter, verse, None), text: r.get(3)?, marked: r.get(4)? })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(VerseResults { total, hits, terms: built.terms, reference })
}

// ---------- importação ----------

#[derive(Deserialize, Clone)]
pub struct BibleMeta {
    pub id: String,
    pub name: String,
    pub abbrev: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub source: String,
}

static TAG_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<f>.*?</f>|<S>.*?</S>|<n>.*?</n>|<[^>]+>").unwrap());

pub fn clean_verse(t: &str) -> String {
    let t = TAG_RE.replace_all(t, "");
    crate::text::squash_spaces(t.trim().trim_matches('"').trim())
}

/// Grava (ou substitui) uma versão inteira.
pub fn save_bible(conn: &mut Connection, meta: &BibleMeta, verses: &[(u32, u32, u32, String)]) -> Result<usize> {
    if verses.is_empty() {
        return Err(AppError::msg("nenhum versículo encontrado no arquivo"));
    }
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM verses WHERE bible_id=?1", [&meta.id])?;
    tx.execute(
        "INSERT OR REPLACE INTO bibles(id, name, abbrev, language, license, source) VALUES (?1,?2,?3,?4,?5,?6)",
        params![meta.id, meta.name, meta.abbrev, if meta.language.is_empty() { "pt" } else { &meta.language }, meta.license, meta.source],
    )?;
    let mut n = 0;
    {
        let mut st = tx.prepare("INSERT OR IGNORE INTO verses(bible_id, book, chapter, verse, text) VALUES (?1,?2,?3,?4,?5)")?;
        for (b, c, v, t) in verses {
            let t = clean_verse(t);
            if (1..=66).contains(b) && !t.is_empty() {
                n += st.execute(params![meta.id, b, c, v, t])?;
            }
        }
    }
    tx.commit()?;
    Ok(n)
}

pub fn delete_bible(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM verses WHERE bible_id=?1", [id])?;
    conn.execute("DELETE FROM bibles WHERE id=?1", [id])?;
    Ok(())
}

fn mybible_book(n: u32) -> Option<u32> {
    BOOKS.iter().position(|b| b.6 == n).map(|i| i as u32 + 1)
}

/// Lê um arquivo SQLite no formato MyBible / EasySlides (`verses(book_number, chapter, verse, text)`).
pub fn read_mybible(path: &std::path::Path) -> Result<(Option<String>, Vec<(u32, u32, u32, String)>)> {
    let src = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let desc: Option<String> = src
        .query_row("SELECT value FROM info WHERE name='description'", [], |r| r.get(0))
        .ok();
    let mut st = src.prepare("SELECT book_number, chapter, verse, text FROM verses ORDER BY book_number, chapter, verse")?;
    let rows = st.query_map([], |r| {
        Ok((r.get::<_, f64>(0)? as u32, r.get::<_, f64>(1)? as u32, r.get::<_, f64>(2)? as u32, r.get::<_, String>(3)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (bn, c, v, t) = row?;
        if let Some(b) = mybible_book(bn) {
            out.push((b, c, v, t));
        }
    }
    Ok((desc, out))
}

fn usfm_book(code: &str) -> Option<u32> {
    let code = code.to_uppercase();
    BOOKS.iter().position(|b| b.5 == code).map(|i| i as u32 + 1)
}

/// Texto VPL do eBible.org: `GEN 1:1 No princípio...` (uma linha por versículo).
pub fn parse_vpl(text: &str) -> Vec<(u32, u32, u32, String)> {
    static LINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*([1-3]?[A-Z]{2,3})\s+(\d+):(\d+)\s+(.*)$").unwrap());
    text.lines()
        .filter_map(|l| {
            let c = LINE.captures(l)?;
            Some((usfm_book(&c[1])?, c[2].parse().ok()?, c[3].parse().ok()?, c[4].to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(s: &str) -> Option<(u32, u32, Option<u32>, Option<u32>)> {
        parse_ref(s).map(|x| (x.book, x.chapter, x.verse, x.verse_end))
    }

    #[test]
    fn refs() {
        assert_eq!(r("jo 3 16"), Some((43, 3, Some(16), None)));
        assert_eq!(r("João 3:16"), Some((43, 3, Some(16), None)));
        assert_eq!(r("Jó 1"), Some((18, 1, None, None)));
        assert_eq!(r("1co13:4-7"), Some((46, 13, Some(4), Some(7))));
        assert_eq!(r("1 Coríntios 13"), Some((46, 13, None, None)));
        assert_eq!(r("i samuel 3"), Some((9, 3, None, None)));
        assert_eq!(r("isaías 53:5"), Some((23, 53, Some(5), None)));
        assert_eq!(r("is 53"), Some((23, 53, None, None)));
        assert_eq!(r("sl 23"), Some((19, 23, None, None)));
        assert_eq!(r("gn 1.1"), Some((1, 1, Some(1), None)));
        assert_eq!(r("apo 22 21"), Some((66, 22, Some(21), None)));
        assert_eq!(r("1jo 4.8"), Some((62, 4, Some(8), None)));
        assert_eq!(r("John 1:1"), Some((43, 1, Some(1), None)));
        assert_eq!(r("cantares 2"), Some((22, 2, None, None)));
        assert_eq!(r("mateus"), Some((40, 1, None, None)));
        assert_eq!(r("sl 151"), None);
        assert_eq!(r("amor de deus"), None);
        // livros de um capítulo só: o número é o versículo (como no Holyrics)
        assert_eq!(r("jd 5"), Some((65, 1, Some(5), None)));
        assert_eq!(r("fm 3-6"), Some((57, 1, Some(3), Some(6))));
        assert_eq!(r("jd 1:5"), Some((65, 1, Some(5), None)));
        assert_eq!(r("judas"), Some((65, 1, None, None)));
    }

    #[test]
    fn search_scopes() {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        let meta = BibleMeta { id: "t".into(), name: "Teste".into(), abbrev: "T".into(), language: "pt".into(), license: String::new(), source: String::new() };
        save_bible(&mut c, &meta, &[(19, 23, 1, "O Senhor é o meu pastor".into()), (43, 10, 11, "Eu sou o bom pastor".into()), (24, 3, 15, "pastor pastor pastor".into())]).unwrap();
        let v = search::Vocab::from_terms(vec![]);
        for (scope, n) in [("all", 3), ("ot", 2), ("nt", 1), ("book", 1)] {
            let r = search(&c, &v, &VerseSearch { query: "pastor".into(), bible: "t".into(), scope: scope.into(), book: 19, ..Default::default() });
            assert!(r.is_ok(), "escopo {scope}: {:?}", r.err().map(|e| e.to_string()));
            assert_eq!(r.unwrap().total, n, "escopo {scope}");
        }
        // ordem bíblica: Salmos antes de Jeremias e de João, mesmo que Jeremias tenha mais ocorrências
        let r = search(&c, &v, &VerseSearch { query: "pastor".into(), bible: "t".into(), scope: "all".into(), sort: "bible".into(), ..Default::default() }).unwrap();
        assert_eq!(r.hits.iter().map(|h| h.book).collect::<Vec<_>>(), vec![19, 24, 43]);
        let r = search(&c, &v, &VerseSearch { query: "pastor".into(), bible: "t".into(), scope: "all".into(), ..Default::default() }).unwrap();
        assert_eq!(r.hits[0].book, 24, "relevância: o versículo com mais ocorrências primeiro");
        // paginação
        let r = search(&c, &v, &VerseSearch { query: "pastor".into(), bible: "t".into(), scope: "all".into(), sort: "bible".into(), limit: 2, offset: 2, ..Default::default() }).unwrap();
        assert_eq!((r.total, r.hits.len(), r.hits[0].book), (3, 1, 43));
    }

    #[test]
    fn ids() {
        assert_eq!(holyrics_id(19, 23, 1), "19023001");
    }

    #[test]
    fn vpl() {
        let v = parse_vpl("GEN 1:1 No princípio criou Deus.\nJHN 3:16 Porque Deus amou.\nTOB 1:1 x");
        assert_eq!(v.len(), 2);
        assert_eq!(v[1].0, 43);
    }

    #[test]
    fn clean() {
        assert_eq!(clean_verse("\"In the <S>7225</S>beginning<f>x</f>  God\""), "In the beginning God");
    }
}
