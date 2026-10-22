//! Livros e séries vindos de arquivos TXT (zip ou pasta): o livro "Uma Exposição das Sete Eras da
//! Igreja" (um TXT por capítulo) e a série dos Sete Selos (um TXT por mensagem, conferida com o que
//! já está no banco para não repetir a mesma tradução).

use crate::db::Result;
use crate::messages::{self, NewVariant};
use crate::text::{fold, squash_spaces};
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

/// Nome do livro das Eras (vai no campo "local" de cada capítulo).
pub const ERAS_BOOK: &str = "Uma Exposição das Sete Eras da Igreja (livro)";
/// O livro saiu em 1965; os capítulos ficam nesta data, com o sufixo do capítulo.
const ERAS_DATE: &str = "1965-0000";

/// Código VGR de cada mensagem da série dos Selos, pela ordem dos arquivos ("03 - O Primeiro Selo").
const SELOS: [&str; 10] = messages::SELOS_CODES;

/// Texto igual (pares de palavras) a uma tradução que já está no banco: não importa de novo.
const SAME: f64 = 0.9;

pub struct TxtFile {
    /// Caminho dentro do zip ou da pasta, em NFC.
    pub path: String,
    pub text: String,
}

#[derive(Serialize, Default, Debug)]
pub struct BooksReport {
    pub eras_chapters: usize,
    pub eras_paragraphs: usize,
    /// Mensagens dos Selos com o mesmo texto de uma tradução que já estava no banco.
    pub selos_same: usize,
    /// Mensagens dos Selos com texto diferente, gravadas como tradução nova.
    pub selos_new: usize,
    pub ignored: Vec<String>,
}

/// Lê os `.txt` de um zip ou de uma pasta (com subpastas). Ignora `__MACOSX` e `.DS_Store`.
pub fn read_txt_files(path: &Path) -> Result<Vec<TxtFile>> {
    let mut out = vec![];
    let keep = |name: &str| {
        let low = name.to_lowercase();
        low.ends_with(".txt") && !low.contains("__macosx") && !low.rsplit(['/', '\\']).next().unwrap_or("").starts_with("._")
    };
    if path.is_dir() {
        let mut stack = vec![path.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for e in std::fs::read_dir(&dir)? {
                let p = e?.path();
                if p.is_dir() {
                    stack.push(p);
                } else {
                    let rel = p.strip_prefix(path).unwrap_or(&p).to_string_lossy().nfc().collect::<String>();
                    if keep(&rel) {
                        out.push(TxtFile { path: rel, text: read_text(&std::fs::read(&p)?) });
                    }
                }
            }
        }
    } else {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?)?;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i)?;
            if f.is_dir() {
                continue;
            }
            let name = f.name()?.nfc().collect::<String>();
            if !keep(&name) {
                continue;
            }
            let mut bytes = vec![];
            f.read_to_end(&mut bytes)?;
            out.push(TxtFile { path: name, text: read_text(&bytes) });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// UTF-8 (com ou sem BOM); se não for, Windows-1252/Latin-1. Sempre em NFC.
fn read_text(bytes: &[u8]) -> String {
    let b = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let s = match std::str::from_utf8(b) {
        Ok(s) => s.to_string(),
        Err(_) => b.iter().map(|&c| c as char).collect(),
    };
    s.nfc().collect()
}

/// "05 - A ERA DA IGREJA DE PÉRGAMO.txt" -> (5, "A Era da Igreja de Pérgamo").
fn numbered_name(path: &str) -> Option<(u32, String)> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(\d{1,2})\s*[-–.]\s*(.+?)\.txt$").unwrap());
    let file = path.rsplit(['/', '\\']).next()?;
    let c = RE.captures(file)?;
    Some((c[1].parse().ok()?, messages::tdf_title(&c[2])))
}

/// Capítulo do livro das Eras: cada linha é um bloco. As linhas numeradas "91-1  texto" (página-parágrafo
/// do livro) perdem o número; títulos ("O MENSAGEIRO") e versículos citados ficam como blocos próprios.
pub fn parse_eras(text: &str) -> Vec<(u32, String)> {
    static NUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*\d{1,3}-\d{1,2}\s+").unwrap());
    text.lines()
        .map(|l| squash_spaces(&NUM.replace(l, "")))
        .filter(|l| !l.is_empty())
        .enumerate()
        .map(|(i, t)| (i as u32 + 1, t))
        .collect()
}

/// Grava o capítulo `n` do livro das Eras no grupo dele (código "ERAS-05"), criando se faltar.
fn save_eras_chapter(conn: &mut Connection, n: u32, title: &str, paragraphs: Vec<(u32, String)>) -> Result<()> {
    let suffix = format!("ERAS{n:02}");
    let tx = conn.transaction()?;
    let gid: Option<i64> = tx
        .query_row("SELECT id FROM msg_groups WHERE date_key=?1 AND suffix=?2", params![ERAS_DATE, suffix], |r| r.get(0))
        .optional()?;
    let gid = match gid {
        Some(g) => g,
        None => {
            tx.execute(
                "INSERT INTO msg_groups(date_key, suffix, code, year, title, local) VALUES (?1,?2,?3,1965,?4,?5)",
                params![ERAS_DATE, suffix, format!("ERAS-{n:02}"), title, ERAS_BOOK],
            )?;
            tx.last_insert_rowid()
        }
    };
    messages::save_into_group(
        &tx,
        gid,
        &NewVariant {
            source: "livro",
            source_id: format!("eras-{n:02}"),
            date_key: ERAS_DATE.into(),
            suffix,
            translation: "Livro".into(),
            title: title.to_string(),
            local: ERAS_BOOK.into(),
            pdf_url: String::new(),
            audio_url: String::new(),
            page_url: String::new(),
            paragraphs,
        },
    )?;
    tx.commit()?;
    Ok(())
}

/// Mensagem dos Selos: se o texto já está no banco (qualquer tradução visível do mesmo código), não
/// grava; se for outra tradução, entra como tradução nova da mesma data.
fn save_selo(conn: &mut Connection, code: &str, title: &str, source_id: String, text: &str) -> Result<bool> {
    let parsed = messages::parse_message(text, false);
    if parsed.paragraphs.is_empty() {
        return Ok(false);
    }
    let visible: Vec<i64> = {
        let mut st = conn.prepare(
            "SELECT v.id FROM msg_variants v JOIN msg_groups g ON g.id = v.group_id
             WHERE g.code = ?1 AND v.para_count > 0 AND v.superseded_by IS NULL AND NOT (v.source='import' AND v.source_id=?2)",
        )?;
        let rows = st.query_map(params![code, source_id], |r| r.get(0))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    let mine = messages::word_pairs(parsed.paragraphs.iter().map(|(_, t)| t.as_str()));
    for id in visible {
        if messages::pair_similarity(&mine, &messages::variant_pairs(conn, id)?) >= SAME {
            return Ok(false);
        }
    }
    let Some((date_key, suffix)) = messages::parse_date(code) else { return Ok(false) };
    let tx = conn.transaction()?;
    messages::save_variant(
        &tx,
        &NewVariant {
            source: "import",
            source_id,
            date_key,
            suffix,
            translation: parsed.translation.clone().unwrap_or_default(),
            title: title.to_string(),
            local: parsed.place.clone().unwrap_or_default(),
            pdf_url: String::new(),
            audio_url: String::new(),
            page_url: String::new(),
            paragraphs: parsed.paragraphs,
        },
    )?;
    tx.commit()?;
    Ok(true)
}

/// Importa os TXT achados: capítulos das Eras e mensagens dos Selos. O resto fica de fora (listado).
pub fn import(conn: &mut Connection, files: &[TxtFile]) -> Result<BooksReport> {
    let mut rep = BooksReport::default();
    for f in files {
        // pela pasta, não pelo nome ("A Brecha Entre as Sete Eras da Igreja…" é da série dos Selos)
        let dir = fold(f.path.rsplit_once(['/', '\\']).map(|(d, _)| d).unwrap_or(""));
        let Some((n, title)) = numbered_name(&f.path) else {
            rep.ignored.push(f.path.clone());
            continue;
        };
        if dir.contains("eras da igreja") {
            let paras = parse_eras(&f.text);
            if paras.is_empty() {
                rep.ignored.push(f.path.clone());
                continue;
            }
            rep.eras_paragraphs += paras.len();
            save_eras_chapter(conn, n, &title, paras)?;
            rep.eras_chapters += 1;
        } else if dir.contains("selos") && (1..=10).contains(&n) {
            if save_selo(conn, SELOS[n as usize - 1], &title, format!("selos-{n:02}"), &f.text)? {
                rep.selos_new += 1;
            } else {
                rep.selos_same += 1;
            }
        } else {
            rep.ignored.push(f.path.clone());
        }
    }
    Ok(rep)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eras_lines() {
        let t = "     91-1  “E ao anjo da igreja que está em Esmirna, escreve:\nEu sei as tuas obras.\nINTRODUÇÃO\t\n            91-2  A fim de relembrar, eu quero.\n\n";
        let p = parse_eras(t);
        assert_eq!(p.len(), 4);
        assert_eq!(p[0], (1, "“E ao anjo da igreja que está em Esmirna, escreve:".to_string()));
        assert_eq!(p[2].1, "INTRODUÇÃO");
        assert_eq!(p[3], (4, "A fim de relembrar, eu quero.".to_string()));
    }

    #[test]
    fn names() {
        assert_eq!(numbered_name("Uma Exposição das Sete Eras da Igreja/05 - A ERA DA IGREJA DE PÉRGAMO.txt"), Some((5, "A Era da Igreja de Pérgamo".to_string())));
        assert_eq!(numbered_name("Os Sete Selos/TXT/03 - O Primeiro Selo.txt"), Some((3, "O Primeiro Selo".to_string())));
        assert_eq!(numbered_name("leia-me.txt"), None);
    }

    #[test]
    fn import_eras_and_same_selo() {
        let dir = std::env::temp_dir().join(format!("avdp-books-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = crate::db::open(&dir.join("t.db")).unwrap();
        // o Primeiro Selo já está no banco com o mesmo texto
        let paras: Vec<(u32, String)> = (1..=30).map(|i| (i, format!("Parágrafo {i} do primeiro selo com palavras bem diferentes número {i} e mais {}", i * 7))).collect();
        let text: String = paras.iter().map(|(n, t)| format!("{n} {t}\n\n")).collect();
        {
            let tx = conn.transaction().unwrap();
            messages::save_variant(
                &tx,
                &NewVariant {
                    source: "tdf",
                    source_id: "WMB1".into(),
                    date_key: "1963-0318".into(),
                    suffix: String::new(),
                    translation: "GVD".into(),
                    title: "O Primeiro Selo".into(),
                    local: String::new(),
                    pdf_url: String::new(),
                    audio_url: String::new(),
                    page_url: String::new(),
                    paragraphs: paras.clone(),
                },
            )
            .unwrap();
            tx.commit().unwrap();
        }
        let files = vec![
            TxtFile { path: "Os Sete Selos/TXT/03 - O Primeiro Selo.txt".into(), text },
            TxtFile { path: "Os Sete Selos/TXT/02 - A Brecha Entre As Sete Eras Da Igreja E Os Sete Selos.txt".into(), text: "1 Texto curto da brecha.\n\n2 Outro.\n\n3 Mais um.\n".into() },
            TxtFile { path: "Uma Exposição das Sete Eras da Igreja/02 - A VISÃO DE PATMOS.txt".into(), text: "     30-1  Texto um.\nTÍTULO\t\n     30-2  Texto dois.\n".into() },
            TxtFile { path: "outra coisa.txt".into(), text: "x".into() },
        ];
        let rep = import(&mut conn, &files).unwrap();
        // a Brecha (texto que não está no banco) entra como tradução nova da 63-0317N, não como capítulo das Eras
        assert_eq!((rep.eras_chapters, rep.eras_paragraphs, rep.selos_same, rep.selos_new, rep.ignored.len()), (1, 3, 1, 1, 1));
        let (code, title, local): (String, String, String) = conn
            .query_row("SELECT code, title, local FROM msg_groups WHERE suffix='ERAS02'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        assert_eq!((code.as_str(), title.as_str(), local.as_str()), ("ERAS-02", "A Visão de Patmos", ERAS_BOOK));
        // importar de novo não duplica
        import(&mut conn, &files).unwrap();
        let n: i64 = conn.query_row("SELECT count(*) FROM msg_variants WHERE source='livro'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
