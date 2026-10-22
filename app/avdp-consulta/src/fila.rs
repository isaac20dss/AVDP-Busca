//! Fila do AVDP (`.avdpfila`, formato de `src-tauri/src/transfer.rs`) → itens da lista do Holyrics.
//!
//! Só leitura do arquivo: música e texto vêm inteiros; versículo pela referência (com a sigla da
//! versão do AVDP, o módulo acha a versão do Holyrics); mensagem pela fonte e §, com o texto do
//! próprio arquivo (serve mesmo se o banco do plugin não tiver a mensagem).

use crate::args::Args;
use crate::commands::{chars, seq_for_num};
use crate::db::Result;
use crate::error::AppError;
use crate::plugin_db;
use crate::slides::{chunk_text, song_text, text_slides};
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const KIND: &str = "avdp-fila";

#[derive(Deserialize, Default)]
#[serde(default)]
struct FilaFile {
    kind: String,
    version: u32,
    id: String,
    name: String,
    from: String,
    exported_at: i64,
    items: Vec<FilaItem>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct FilaItem {
    kind: String,
    label: String,
    r#ref: Value,
    song: Option<FSong>,
    text: Option<FText>,
    message: Option<FMessage>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct FSong {
    title: String,
    artist: String,
    author: String,
    lyrics: String,
    paragraph_order: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct FText {
    title: String,
    body: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct FMessage {
    code: String,
    source: String,
    source_id: String,
    translation: String,
    title: String,
    num: Option<i64>,
    paragraphs: Vec<(i64, String)>,
}

/// Cabeçalho, para a lista de arquivos (sem montar os itens).
#[derive(Deserialize, Default)]
#[serde(default)]
struct FilaHead {
    kind: String,
    name: String,
    from: String,
    exported_at: i64,
    items: Vec<serde::de::IgnoredAny>,
}

fn read_text(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path)?;
    let s = String::from_utf8(bytes).map_err(|_| AppError::msg("o arquivo da fila não está em UTF-8"))?;
    Ok(s.trim_start_matches('\u{feff}').to_string())
}

/// Pastas onde a fila costuma estar: Downloads, Área de Trabalho, Documentos (também no OneDrive),
/// a pasta do plugin e a do programa (biblioteca do Holyrics), mais `--dir`.
fn folders(a: &Args) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = vec![];
    if let Some(d) = a.get("dir") {
        out.push(PathBuf::from(d));
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        let home = PathBuf::from(home);
        for sub in ["Downloads", "Desktop", "Documents", r"OneDrive\Desktop", r"OneDrive\Área de Trabalho", r"OneDrive\Documentos", r"OneDrive\Documents"] {
            out.push(home.join(sub));
        }
    }
    out.push(PathBuf::from(plugin_db::DEFAULT_DIR));
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        out.push(dir);
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| p.is_dir() && seen.insert(p.canonicalize().unwrap_or_else(|_| p.clone())));
    out
}

/// Filas achadas, a mais nova primeiro.
pub fn list(a: &Args) -> Result<Value> {
    let dirs = folders(a);
    let mut files: Vec<(u64, Value)> = vec![];
    for d in &dirs {
        let Ok(rd) = std::fs::read_dir(d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("avdpfila")) {
                continue;
            }
            let modified = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let Ok(head) = read_text(&p).and_then(|s| Ok(serde_json::from_str::<FilaHead>(&s)?)) else { continue };
            if head.kind != KIND {
                continue;
            }
            files.push((
                modified,
                json!({ "path": p.display().to_string(), "file": e.file_name().to_string_lossy(), "name": head.name, "from": head.from, "items": head.items.len(), "exported_at": head.exported_at, "modified_ms": modified }),
            ));
        }
    }
    files.sort_by(|x, y| y.0.cmp(&x.0));
    files.truncate(a.num("limit").unwrap_or(30).clamp(1, 200) as usize);
    Ok(json!({ "files": files.into_iter().map(|f| f.1).collect::<Vec<_>>(), "folders": dirs.iter().map(|d| d.display().to_string()).collect::<Vec<_>>() }))
}

fn bible_info(c: &Connection, id: &str) -> Result<(String, String)> {
    for t in ["plugin_bibles", "bibles"] {
        if plugin_db::has_table(c, t)? {
            if let Some(r) = c.query_row(&format!("SELECT abbrev, name FROM {t} WHERE id=?1"), [id], |r| Ok((r.get(0)?, r.get(1)?))).optional()? {
                return Ok(r);
            }
        }
    }
    Ok((id.to_uppercase(), String::new()))
}

/// Quantos versículos tem o capítulo (na versão do item, senão na que tiver mais).
fn chapter_len(c: &Connection, bible: &str, book: i64, chapter: i64) -> Result<Option<i64>> {
    let (table, col) = if plugin_db::has_table(c, "plugin_chapters")? {
        ("plugin_chapters", "n")
    } else if plugin_db::has_table(c, "verses")? {
        ("(SELECT bible_id, book, chapter, max(verse) AS n FROM verses GROUP BY bible_id, book, chapter)", "n")
    } else {
        return Ok(None);
    };
    Ok(c
        .query_row(&format!("SELECT {col} FROM {table} WHERE book=?1 AND chapter=?2 ORDER BY (bible_id=?3) DESC, {col} DESC LIMIT 1"), rusqlite::params![book, chapter, bible], |r| {
            r.get(0)
        })
        .optional()?)
}

/// LLCCCVVV, como o Holyrics.
fn holyrics_id(book: i64, chapter: i64, verse: i64) -> String {
    format!("{book:02}{chapter:03}{verse:03}")
}

fn verse_item(c: Option<&Connection>, it: &FilaItem) -> Result<Value> {
    let r = &it.r#ref;
    let (Some(book), Some(chapter)) = (r["book"].as_i64(), r["chapter"].as_i64()) else {
        return Ok(json!({ "kind": "verse", "label": it.label, "ids": [], "error": "referência sem livro/capítulo" }));
    };
    let bible = r["bible"].as_str().unwrap_or("").to_string();
    let mut verses: Vec<i64> = r["verses"].as_array().map(|v| v.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
    if verses.is_empty() {
        if let Some(v) = r["verse"].as_i64() {
            verses.push(v);
        }
    }
    let mut whole_chapter = false;
    if verses.is_empty() {
        // capítulo inteiro
        whole_chapter = true;
        if let Some(n) = c.map(|c| chapter_len(c, &bible, book, chapter)).transpose()?.flatten() {
            verses = (1..=n).collect();
        }
    }
    verses.sort_unstable();
    verses.dedup();
    let (mut abbrev, name) = match (c, bible.is_empty()) {
        (Some(c), false) => bible_info(c, &bible)?,
        _ => (bible.to_uppercase(), String::new()),
    };
    if abbrev.is_empty() {
        // item antigo sem a versão na referência: a sigla vem no fim do rótulo ("Gênesis 1:1 — BPM")
        abbrev = it.label.rsplit_once(" — ").map(|(_, s)| s.trim().to_string()).filter(|s| !s.is_empty() && !s.contains(' ')).unwrap_or_default();
    }
    Ok(json!({
        "kind": "verse", "label": it.label, "book": book, "chapter": chapter, "verses": verses, "whole_chapter": whole_chapter,
        "ids": verses.iter().map(|&v| holyrics_id(book, chapter, v)).collect::<Vec<_>>(),
        "bible": bible, "bible_abbrev": abbrev, "bible_name": name,
    }))
}

fn message_item(c: Option<&Connection>, it: &FilaItem, max: usize) -> Result<Value> {
    let Some(m) = &it.message else {
        return Ok(json!({ "kind": "message", "label": it.label, "error": "mensagem sem dados no arquivo" }));
    };
    let start = m.num.and_then(|n| m.paragraphs.iter().position(|(k, _)| *k >= n)).unwrap_or(0);
    let text = m.paragraphs.iter().skip(start).flat_map(|(_, t)| chunk_text(t, max)).collect::<Vec<_>>().join("\n\n");
    let first_num = m.paragraphs.get(start).map(|(k, _)| *k).filter(|&k| k > 0);
    let name = format!("{} {}{}", m.code, m.title, first_num.map(|n| format!(" — §{n}")).unwrap_or_default()).trim().to_string();
    // a mesma mensagem no banco do plugin (para o item que busca o texto na hora)
    let mut found = json!(null);
    if let Some(c) = c {
        let row: Option<(i64, i64)> = c
            .query_row("SELECT id, group_id FROM msg_variants WHERE source=?1 AND source_id=?2 AND para_count > 0", [m.source.as_str(), m.source_id.as_str()], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        if let Some((vid, gid)) = row {
            let seq = seq_for_num(c, vid, first_num)?.map(|(s, _)| s);
            found = json!({ "variant": vid, "group": gid, "seq": seq });
        }
    }
    Ok(json!({
        "kind": "message", "label": it.label, "name": name, "text": text,
        "code": m.code, "title": m.title, "translation": m.translation, "source": m.source, "source_id": m.source_id,
        "num": first_num, "paragraphs": m.paragraphs.len() - start, "found": found,
    }))
}

/// Itens da fila prontos para o módulo montar a lista do Holyrics.
pub fn convert(a: &Args) -> Result<Value> {
    let path = a.get("file").ok_or_else(|| AppError::msg("falta --file <arquivo.avdpfila>"))?;
    let path = PathBuf::from(path.trim());
    if !path.is_file() {
        return Err(AppError::msg(format!("arquivo não encontrado: {}", path.display())));
    }
    let f: FilaFile = serde_json::from_str(&read_text(&path)?).map_err(|e| AppError::msg(format!("arquivo de fila inválido: {e}")))?;
    if f.kind != KIND {
        return Err(AppError::msg("este arquivo não é uma fila do AVDP Busca"));
    }
    // sem o banco a fila ainda vai (versículos sem capítulo inteiro, mensagens como texto)
    let (conn, db_note) = match plugin_db::open(a) {
        Ok((c, _)) => (Some(c), Value::Null),
        Err(e) => (None, Value::String(e.to_string())),
    };
    let c = conn.as_ref();
    let max = chars(a);
    let mut items = vec![];
    for it in &f.items {
        let v = match it.kind.as_str() {
            "song" => match &it.song {
                Some(s) => json!({ "kind": "song", "label": it.label, "title": s.title, "artist": if s.artist.trim().is_empty() { &s.author } else { &s.artist }, "text": song_text(&s.lyrics, &s.paragraph_order) }),
                None => json!({ "kind": "song", "label": it.label, "error": "música sem letra no arquivo" }),
            },
            "text" => match &it.text {
                Some(t) => json!({ "kind": "text", "label": it.label, "title": t.title, "text": text_slides(&t.body, max).join("\n\n") }),
                None => json!({ "kind": "text", "label": it.label, "error": "texto sem conteúdo no arquivo" }),
            },
            "verse" => verse_item(c, it)?,
            "message" => message_item(c, it, max)?,
            other => json!({ "kind": other, "label": it.label }),
        };
        items.push(v);
    }
    Ok(json!({ "name": f.name, "from": f.from, "id": f.id, "version": f.version, "exported_at": f.exported_at, "items": items, "db_error": db_note }))
}
