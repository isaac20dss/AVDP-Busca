//! Músicas e textos avulsos, com a busca melhorada.

use crate::db::Result;
use crate::search::{self, QueryOpts};
use crate::text::fold;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Song {
    pub id: i64,
    pub title: String,
    pub artist: String,
    pub author: String,
    pub note: String,
    pub lyrics: String,
    pub paragraph_order: String,
    pub copyright: String,
    pub source: String,
    pub theme_id: Option<i64>,
    pub play_count: i64,
}

fn row_to_song(r: &rusqlite::Row) -> rusqlite::Result<Song> {
    Ok(Song {
        id: r.get(0)?,
        title: r.get(1)?,
        artist: r.get(2)?,
        author: r.get(3)?,
        note: r.get(4)?,
        lyrics: r.get(5)?,
        paragraph_order: r.get(6)?,
        copyright: r.get(7)?,
        source: r.get(8)?,
        theme_id: r.get(9)?,
        play_count: r.get(10)?,
    })
}

const SONG_COLS: &str = "id, title, artist, author, note, lyrics, paragraph_order, copyright, source, theme_id, play_count";

pub fn get(conn: &Connection, id: i64) -> Result<Song> {
    Ok(conn.query_row(&format!("SELECT {SONG_COLS} FROM songs WHERE id=?1"), [id], row_to_song)?)
}

pub fn save(conn: &Connection, s: &Song) -> Result<i64> {
    let title = if s.title.trim().is_empty() { first_line(&s.lyrics) } else { s.title.trim().to_string() };
    if s.id > 0 {
        conn.execute(
            "UPDATE songs SET title=?2, artist=?3, author=?4, note=?5, lyrics=?6, paragraph_order=?7, copyright=?8,
               source=?9, theme_id=?10, updated_at=unixepoch() WHERE id=?1",
            params![s.id, title, s.artist.trim(), s.author, s.note, s.lyrics, s.paragraph_order, s.copyright, s.source, s.theme_id],
        )?;
        Ok(s.id)
    } else {
        conn.execute(
            "INSERT INTO songs(title, artist, author, note, lyrics, paragraph_order, copyright, source, theme_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![title, s.artist.trim(), s.author, s.note, s.lyrics, s.paragraph_order, s.copyright, s.source, s.theme_id],
        )?;
        Ok(conn.last_insert_rowid())
    }
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM songs WHERE id=?1", [id])?;
    Ok(())
}

pub fn mark_played(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("UPDATE songs SET play_count=play_count+1, last_played=unixepoch() WHERE id=?1", [id])?;
    Ok(())
}

fn first_line(lyrics: &str) -> String {
    lyrics.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("Sem título").chars().take(80).collect()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ImportResult {
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
}

/// Importa várias músicas. `on_duplicate`: "skip" | "replace" | "keep" (mantém as duas).
pub fn import(conn: &mut Connection, songs: &[Song], on_duplicate: &str) -> Result<ImportResult> {
    let tx = conn.transaction()?;
    let dup_key = |t: &str, a: &str| format!("{}|{}", fold(t.trim()), fold(a.trim()));
    let mut existing: HashMap<String, i64> = {
        let mut st = tx.prepare("SELECT id, title, artist FROM songs")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
        rows.filter_map(|r| r.ok()).map(|(id, t, a)| (dup_key(&t, &a), id)).collect()
    };
    let mut res = ImportResult { added: 0, updated: 0, skipped: 0 };
    for s in songs {
        if s.lyrics.trim().is_empty() {
            res.skipped += 1;
            continue;
        }
        let title = if s.title.trim().is_empty() { first_line(&s.lyrics) } else { s.title.trim().to_string() };
        let key = dup_key(&title, &s.artist);
        let dup = existing.get(&key).copied();
        match (dup, on_duplicate) {
            (Some(_), "skip") => res.skipped += 1,
            (Some(id), "replace") => {
                let mut s2 = s.clone();
                s2.id = id;
                s2.title = title;
                save(&tx, &s2)?;
                res.updated += 1;
            }
            _ => {
                let mut s2 = s.clone();
                s2.id = 0;
                s2.title = title;
                let id = save(&tx, &s2)?;
                existing.insert(key, id);
                res.added += 1;
            }
        }
    }
    tx.commit()?;
    Ok(res)
}

#[derive(Serialize)]
pub struct SongHit {
    pub id: i64,
    pub title: String,
    pub artist: String,
    /// Trecho da letra com ⟦ ⟧ (vazio se achou só no título/artista).
    pub marked: String,
    /// "title" | "artist" | "lyrics"
    pub matched: String,
    pub play_count: i64,
}

#[derive(Serialize)]
pub struct SongResults {
    pub hits: Vec<SongHit>,
    pub total: usize,
    pub terms: Vec<String>,
    /// Nada exato; resultados por aproximação (erro de digitação).
    pub approximate: bool,
}

/// Busca de músicas: título > começo do título > artista > letra; acentos e maiúsculas não importam;
/// aceita a sintaxe da busca avançada; se nada achar, tenta por aproximação.
pub fn search(conn: &Connection, vocab: &search::Vocab, query: &str, opts: &QueryOpts, sort: &str) -> Result<SongResults> {
    let q = query.trim();
    if q.is_empty() {
        let order = match sort {
            "recent" => "last_played DESC NULLS LAST, title COLLATE NOCASE",
            "most" => "play_count DESC, title COLLATE NOCASE",
            "artist" => "artist COLLATE NOCASE, title COLLATE NOCASE",
            _ => "title COLLATE NOCASE",
        };
        let mut st = conn.prepare(&format!("SELECT id, title, artist, play_count FROM songs ORDER BY {order}"))?;
        let hits: Vec<SongHit> = st
            .query_map([], |r| {
                Ok(SongHit { id: r.get(0)?, title: r.get(1)?, artist: r.get(2)?, marked: String::new(), matched: String::new(), play_count: r.get(3)? })
            })?
            .collect::<std::result::Result<_, _>>()?;
        let total = hits.len();
        return Ok(SongResults { hits, total, terms: vec![], approximate: false });
    }
    let fields = [("titulo", "title"), ("title", "title"), ("artista", "artist"), ("artist", "artist"), ("letra", "lyrics"), ("lyrics", "lyrics")];
    let mut res = run_song_query(conn, vocab, q, opts, &fields)?;
    if res.hits.is_empty() && !opts.fuzzy && q.chars().count() >= 4 {
        let mut o = opts.clone();
        o.fuzzy = true;
        o.whole_word = true;
        res = run_song_query(conn, vocab, q, &o, &fields)?;
        res.approximate = !res.hits.is_empty();
    }
    Ok(res)
}

fn run_song_query(conn: &Connection, vocab: &search::Vocab, q: &str, opts: &QueryOpts, fields: &[(&str, &str)]) -> Result<SongResults> {
    let Some(built) = search::build(q, opts, vocab, fields) else {
        return Ok(SongResults { hits: vec![], total: 0, terms: vec![], approximate: false });
    };
    let qf = fold(q);
    let mut st = conn.prepare(
        "SELECT s.id, s.title, s.artist, s.play_count, bm25(songs_fts, 12.0, 4.0, 1.0),
                snippet(songs_fts, 2, '⟦', '⟧', '…', 12),
                highlight(songs_fts, 0, '⟦', '⟧'), highlight(songs_fts, 1, '⟦', '⟧')
         FROM songs_fts JOIN songs s ON s.id = songs_fts.rowid
         WHERE songs_fts MATCH ?1 LIMIT 500",
    )?;
    let mut scored: Vec<(f64, SongHit)> = st
        .query_map([&built.fts], |r| {
            let title: String = r.get(1)?;
            let artist: String = r.get(2)?;
            let bm: f64 = r.get(4)?;
            let snip: String = r.get(5)?;
            let ht: String = r.get(6)?;
            let ha: String = r.get(7)?;
            Ok((bm, title, artist, r.get::<_, i64>(0)?, r.get::<_, i64>(3)?, snip, ht, ha))
        })?
        .filter_map(|r| r.ok())
        .map(|(bm, title, artist, id, plays, snip, ht, ha)| {
            let tf = fold(&title);
            let mut score = -bm;
            if tf == qf {
                score += 100.0;
            } else if tf.starts_with(&qf) {
                score += 60.0;
            } else if tf.contains(&qf) {
                score += 30.0;
            }
            if fold(&artist).contains(&qf) {
                score += 10.0;
            }
            score += (plays as f64).ln_1p() * 0.5;
            let matched = if ht.contains('⟦') {
                "title"
            } else if ha.contains('⟦') {
                "artist"
            } else {
                "lyrics"
            };
            let marked = if snip.contains('⟦') { snip } else { String::new() };
            (score, SongHit { id, title, artist, marked, matched: matched.into(), play_count: plays })
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let total = scored.len();
    Ok(SongResults { hits: scored.into_iter().map(|x| x.1).collect(), total, terms: built.terms, approximate: false })
}

// ---------- textos avulsos ----------

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct TextDoc {
    pub id: i64,
    pub title: String,
    pub body: String,
    pub source: String,
}

pub fn list_texts(conn: &Connection, query: &str, vocab: &search::Vocab) -> Result<Vec<TextDoc>> {
    let q = query.trim();
    let mut out = vec![];
    if q.is_empty() {
        let mut st = conn.prepare("SELECT id, title, '', source FROM texts ORDER BY updated_at DESC")?;
        for r in st.query_map([], |r| Ok(TextDoc { id: r.get(0)?, title: r.get(1)?, body: r.get(2)?, source: r.get(3)? }))? {
            out.push(r?);
        }
        return Ok(out);
    }
    let Some(b) = search::build(q, &QueryOpts::default(), vocab, &[("titulo", "title"), ("title", "title")]) else { return Ok(out) };
    let mut st = conn.prepare(
        "SELECT t.id, t.title, snippet(texts_fts, 1, '⟦', '⟧', '…', 14), t.source FROM texts_fts JOIN texts t ON t.id = texts_fts.rowid
         WHERE texts_fts MATCH ?1 ORDER BY bm25(texts_fts, 8.0, 1.0) LIMIT 300",
    )?;
    for r in st.query_map([b.fts], |r| Ok(TextDoc { id: r.get(0)?, title: r.get(1)?, body: r.get(2)?, source: r.get(3)? }))? {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_text(conn: &Connection, id: i64) -> Result<TextDoc> {
    Ok(conn.query_row("SELECT id, title, body, source FROM texts WHERE id=?1", [id], |r| {
        Ok(TextDoc { id: r.get(0)?, title: r.get(1)?, body: r.get(2)?, source: r.get(3)? })
    })?)
}

pub fn save_text(conn: &Connection, t: &TextDoc) -> Result<i64> {
    let title = if t.title.trim().is_empty() { first_line(&t.body) } else { t.title.trim().to_string() };
    if t.id > 0 {
        conn.execute("UPDATE texts SET title=?2, body=?3, source=?4, updated_at=unixepoch() WHERE id=?1", params![t.id, title, t.body, t.source])?;
        Ok(t.id)
    } else {
        conn.execute("INSERT INTO texts(title, body, source) VALUES (?1,?2,?3)", params![title, t.body, t.source])?;
        Ok(conn.last_insert_rowid())
    }
}

pub fn delete_text(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM texts WHERE id=?1", [id])?;
    Ok(())
}

// ---------- listas de reprodução ----------

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct PlaylistItem {
    pub kind: String,
    /// JSON com a referência do item (id da música, versículos, parágrafos...).
    pub r#ref: String,
    pub label: String,
}

#[derive(Serialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
    pub items: i64,
}

pub fn playlists(conn: &Connection) -> Result<Vec<Playlist>> {
    let mut st = conn.prepare(
        "SELECT p.id, p.name, p.created_at, (SELECT count(*) FROM playlist_items i WHERE i.playlist_id=p.id)
         FROM playlists p ORDER BY p.created_at DESC",
    )?;
    let rows = st.query_map([], |r| Ok(Playlist { id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)?, items: r.get(3)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn create_playlist(conn: &Connection, name: &str) -> Result<i64> {
    conn.execute("INSERT INTO playlists(name) VALUES (?1)", [name])?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_playlist(conn: &Connection, id: i64, name: &str) -> Result<()> {
    conn.execute("UPDATE playlists SET name=?2 WHERE id=?1", params![id, name])?;
    Ok(())
}

pub fn delete_playlist(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM playlists WHERE id=?1", [id])?;
    Ok(())
}

pub fn playlist_items(conn: &Connection, id: i64) -> Result<Vec<PlaylistItem>> {
    let mut st = conn.prepare("SELECT kind, ref, label FROM playlist_items WHERE playlist_id=?1 ORDER BY pos")?;
    let rows = st.query_map([id], |r| Ok(PlaylistItem { kind: r.get(0)?, r#ref: r.get(1)?, label: r.get(2)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn set_playlist_items(conn: &mut Connection, id: i64, items: &[PlaylistItem]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM playlist_items WHERE playlist_id=?1", [id])?;
    for (i, it) in items.iter().enumerate() {
        tx.execute(
            "INSERT INTO playlist_items(playlist_id, pos, kind, ref, label) VALUES (?1,?2,?3,?4,?5)",
            params![id, i as i64, it.kind, it.r#ref, it.label],
        )?;
    }
    tx.commit()?;
    Ok(())
}

// ---------- histórico de buscas ----------

#[derive(Serialize)]
pub struct HistoryItem {
    pub id: i64,
    pub scope: String,
    pub query: String,
    pub opts: String,
    pub hits: i64,
    pub at: i64,
}

pub fn add_history(conn: &Connection, scope: &str, query: &str, opts: &str, hits: i64) -> Result<()> {
    if query.trim().is_empty() {
        return Ok(());
    }
    conn.execute("DELETE FROM search_history WHERE scope=?1 AND query=?2", params![scope, query.trim()])?;
    conn.execute(
        "INSERT INTO search_history(scope, query, opts, hits) VALUES (?1,?2,?3,?4)",
        params![scope, query.trim(), opts, hits],
    )?;
    conn.execute(
        "DELETE FROM search_history WHERE scope=?1 AND id NOT IN (SELECT id FROM search_history WHERE scope=?1 ORDER BY id DESC LIMIT 60)",
        [scope],
    )?;
    Ok(())
}

pub fn history(conn: &Connection, scope: &str) -> Result<Vec<HistoryItem>> {
    let mut st = conn.prepare("SELECT id, scope, query, opts, hits, at FROM search_history WHERE scope=?1 ORDER BY id DESC LIMIT 60")?;
    let rows = st.query_map([scope], |r| {
        Ok(HistoryItem { id: r.get(0)?, scope: r.get(1)?, query: r.get(2)?, opts: r.get(3)?, hits: r.get(4)?, at: r.get(5)? })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn clear_history(conn: &Connection, scope: &str) -> Result<()> {
    conn.execute("DELETE FROM search_history WHERE scope=?1", [scope])?;
    Ok(())
}

pub fn settings(conn: &Connection) -> Result<HashMap<String, String>> {
    let mut st = conn.prepare("SELECT key, value FROM settings")?;
    let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn song_search_ranks_title_first() {
        let mut c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        let mk = |t: &str, a: &str, l: &str| Song { title: t.into(), artist: a.into(), lyrics: l.into(), ..Default::default() };
        import(
            &mut c,
            &[
                mk("Grandioso És Tu", "Hinário", "Senhor meu Deus, quando eu maravilhado\nContemplo a tua imensa criação"),
                mk("Ao Único", "Aline Barros", "Ao único que é digno de receber\nA honra e a glória, Grandioso"),
                mk("Porque Ele Vive", "Harpa", "Deus enviou seu filho amado"),
            ],
            "skip",
        )
        .unwrap();
        let v = search::Vocab::from_terms(vec!["grandioso".into(), "contemplo".into(), "vive".into()]);
        let r = search(&c, &v, "grandioso", &QueryOpts::default(), "").unwrap();
        assert_eq!(r.hits[0].title, "Grandioso És Tu");
        assert_eq!(r.hits.len(), 2);
        assert_eq!(r.hits[1].matched, "lyrics");
        // erro de digitação cai na busca aproximada
        let r = search(&c, &v, "contenplo", &QueryOpts::default(), "").unwrap();
        assert!(r.approximate);
        assert_eq!(r.hits[0].title, "Grandioso És Tu");
        // duplicada é ignorada
        let res = import(&mut c, &[mk("grandioso és tu", "hinário", "x")], "skip").unwrap();
        assert_eq!(res.skipped, 1);
    }
}
