//! Biblioteca de mídia: imagens, vídeos e áudios (arquivos do computador, referenciados pelo caminho).

use crate::db::Result;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const IMAGE: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif"];
pub const VIDEO: &[&str] = &["mp4", "webm", "mov", "m4v", "ogv", "mkv"];
pub const AUDIO: &[&str] = &["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus", "wma"];

pub fn kind_of(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    if IMAGE.contains(&ext.as_str()) {
        Some("image")
    } else if VIDEO.contains(&ext.as_str()) {
        Some("video")
    } else if AUDIO.contains(&ext.as_str()) {
        Some("audio")
    } else {
        None
    }
}

#[derive(Serialize)]
pub struct MediaFile {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub kind: String,
    pub folder: String,
    pub size: i64,
    pub exists: bool,
}

fn collect(p: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    if p.is_dir() {
        if depth > 6 {
            return;
        }
        if let Ok(rd) = std::fs::read_dir(p) {
            let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
            entries.sort();
            for e in entries {
                collect(&e, depth + 1, out);
            }
        }
    } else if kind_of(p).is_some() {
        out.push(p.to_path_buf());
    }
}

/// Adiciona arquivos (ou pastas inteiras). Devolve os caminhos novos.
pub fn add_paths(conn: &Connection, paths: &[String]) -> Result<Vec<PathBuf>> {
    let mut files = vec![];
    for p in paths {
        collect(Path::new(p), 0, &mut files);
    }
    let mut added = vec![];
    let mut st = conn.prepare("INSERT OR IGNORE INTO media(path, name, kind, folder, size) VALUES (?1,?2,?3,?4,?5)")?;
    for f in files {
        let kind = kind_of(&f).unwrap_or("image");
        let name = f.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let folder = f.parent().and_then(|d| d.file_name()).map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let size = std::fs::metadata(&f).map(|m| m.len() as i64).unwrap_or(0);
        if st.execute(params![f.display().to_string(), name, kind, folder, size])? > 0 {
            added.push(f);
        }
    }
    Ok(added)
}

pub fn list(conn: &Connection, kind: &str, query: &str) -> Result<Vec<MediaFile>> {
    let q = format!("%{}%", crate::text::fold(query.trim()));
    let mut st = conn.prepare(
        "SELECT id, path, name, kind, folder, size FROM media
         WHERE (?1 = '' OR kind = ?1) AND (?2 = '%%' OR lower(name) LIKE ?2 OR lower(folder) LIKE ?2)
         ORDER BY folder COLLATE NOCASE, name COLLATE NOCASE",
    )?;
    let rows = st.query_map(params![kind, q], |r| {
        let path: String = r.get(1)?;
        Ok(MediaFile {
            id: r.get(0)?,
            exists: Path::new(&path).exists(),
            path,
            name: r.get(2)?,
            kind: r.get(3)?,
            folder: r.get(4)?,
            size: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM media WHERE id=?1", [id])?;
    Ok(())
}

pub fn all_paths(conn: &Connection) -> Result<Vec<String>> {
    let mut st = conn.prepare("SELECT path FROM media")?;
    let rows = st.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}
