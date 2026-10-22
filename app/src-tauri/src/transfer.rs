//! Levar a lista de reprodução de um computador para outro: arquivo `.avdpfila` (JSON).
//!
//! Bíblia e mídia vão pela referência (livro/capítulo/versículo e caminho). Música e texto vão
//! inteiros. Mensagem vai pela fonte (código da data, fonte, id na fonte e §), porque os ids do
//! banco mudam de um PC para outro, e leva também o texto da tradução: se o outro PC não tiver a
//! mensagem, ela é baixada do Tabernáculo da Fé (quando é de lá) ou gravada a partir do arquivo.

use crate::db::Result;
use crate::error::AppError;
use crate::messages::{self, NewVariant, TdfParagraph, TdfTitle};
use crate::songs::{self, PlaylistItem, Song, TextDoc};
use crate::text::fold;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

pub const KIND: &str = "avdp-fila";

#[derive(Serialize, Deserialize)]
pub struct FilaFile {
    pub kind: String,
    pub version: u32,
    /// Identidade da lista de origem (computador + lista): importar de novo atualiza a mesma lista.
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub exported_at: i64,
    pub items: Vec<FilaItem>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct FilaItem {
    pub kind: String,
    pub label: String,
    pub r#ref: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub song: Option<Song>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<TextDoc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<FilaMessage>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default)]
pub struct FilaMessage {
    pub code: String,
    pub date_key: String,
    pub suffix: String,
    pub source: String,
    pub source_id: String,
    pub translation: String,
    pub title: String,
    pub local: String,
    pub pdf_url: String,
    pub audio_url: String,
    pub page_url: String,
    /// § escolhido na lista (nenhum = do começo).
    pub num: Option<i64>,
    /// Texto da tradução, para o outro PC gravar se não tiver a mensagem.
    pub paragraphs: Vec<(u32, String)>,
}

#[derive(Serialize, Default, Debug)]
pub struct FilaReport {
    pub playlist_id: i64,
    pub name: String,
    pub items: usize,
    /// A lista já tinha sido importada antes e foi atualizada.
    pub updated: bool,
    pub songs_new: usize,
    pub songs_updated: usize,
    pub texts_new: usize,
    pub texts_updated: usize,
    pub messages_downloaded: usize,
    pub messages_from_file: usize,
    /// Itens que não deu para trazer (ou mídia que não existe neste PC).
    pub missing: Vec<String>,
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

// ---------- exportar ----------

pub fn export(conn: &Connection, playlist_id: i64, computer: &str) -> Result<FilaFile> {
    let (name, created): (String, i64) =
        conn.query_row("SELECT name, created_at FROM playlists WHERE id=?1", [playlist_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let mut items = vec![];
    for it in songs::playlist_items(conn, playlist_id)? {
        let r: Value = serde_json::from_str(&it.r#ref).unwrap_or(Value::Null);
        let mut out = FilaItem { kind: it.kind.clone(), label: it.label.clone(), r#ref: r.clone(), ..Default::default() };
        match it.kind.as_str() {
            "song" => {
                out.song = r["id"].as_i64().and_then(|id| songs::get(conn, id).ok()).map(|mut s| {
                    s.id = 0;
                    s.play_count = 0;
                    s
                })
            }
            "text" => {
                out.text = r["id"].as_i64().and_then(|id| songs::get_text(conn, id).ok()).map(|mut t| {
                    t.id = 0;
                    t
                })
            }
            "message" => out.message = export_message(conn, &r)?,
            _ => {}
        }
        items.push(out);
    }
    Ok(FilaFile { kind: KIND.into(), version: 1, id: format!("{computer}#{playlist_id}#{created}"), name, from: computer.into(), exported_at: now(), items })
}

fn export_message(conn: &Connection, r: &Value) -> Result<Option<FilaMessage>> {
    let Some(gid) = r["groupId"].as_i64() else { return Ok(None) };
    let vid = match r["variantId"].as_i64() {
        Some(v) => Some(v),
        None => conn.query_row("SELECT preferred_variant FROM msg_groups WHERE id=?1", [gid], |x| x.get::<_, Option<i64>>(0)).optional()?.flatten(),
    };
    let Some(vid) = vid else { return Ok(None) };
    let row = conn
        .query_row(
            "SELECT g.code, g.date_key, g.suffix, v.source, v.source_id, v.translation, v.title, v.local, v.pdf_url, v.audio_url, v.page_url
             FROM msg_variants v JOIN msg_groups g ON g.id = v.group_id WHERE v.id=?1",
            [vid],
            |x| {
                Ok(FilaMessage {
                    code: x.get(0)?,
                    date_key: x.get(1)?,
                    suffix: x.get(2)?,
                    source: x.get(3)?,
                    source_id: x.get(4)?,
                    translation: x.get(5)?,
                    title: x.get(6)?,
                    local: x.get(7)?,
                    pdf_url: x.get(8)?,
                    audio_url: x.get(9)?,
                    page_url: x.get(10)?,
                    ..Default::default()
                })
            },
        )
        .optional()?;
    let Some(mut m) = row else { return Ok(None) };
    m.num = match (r["num"].as_i64(), r["seq"].as_i64()) {
        (Some(n), _) => Some(n),
        (None, Some(seq)) => conn.query_row("SELECT num FROM msg_paragraphs WHERE variant_id=?1 AND seq=?2", params![vid, seq], |x| x.get(0)).optional()?,
        _ => None,
    };
    let mut st = conn.prepare("SELECT num, text FROM msg_paragraphs WHERE variant_id=?1 ORDER BY seq")?;
    m.paragraphs = st.query_map([vid], |x| Ok((x.get(0)?, x.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
    Ok(Some(m))
}

// ---------- importar ----------

fn find_variant(conn: &Connection, source: &str, source_id: &str) -> Result<Option<(i64, i64)>> {
    Ok(conn
        .query_row("SELECT id, group_id FROM msg_variants WHERE source=?1 AND source_id=?2 AND para_count > 0", [source, source_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?)
}

/// Mensagens do Tabernáculo da Fé que estão no arquivo e faltam neste PC (para baixar antes).
pub fn missing_tdf(conn: &Connection, f: &FilaFile) -> Result<Vec<String>> {
    let mut out = vec![];
    for m in f.items.iter().filter_map(|i| i.message.as_ref()) {
        if m.source == "tdf" && !out.contains(&m.source_id) && find_variant(conn, &m.source, &m.source_id)?.is_none() {
            out.push(m.source_id.clone());
        }
    }
    Ok(out)
}

/// Grava a lista do arquivo. `downloaded`: parágrafos baixados do site por código WMB…;
/// `imports`: listas importadas antes (id do arquivo → lista deste PC), atualizado aqui.
pub fn import(conn: &mut Connection, f: &FilaFile, downloaded: &HashMap<String, Vec<TdfParagraph>>, imports: &mut HashMap<String, i64>) -> Result<FilaReport> {
    if f.kind != KIND {
        return Err(AppError::msg("este arquivo não é uma fila do AVDP Busca"));
    }
    let mut rep = FilaReport::default();

    // 1) mensagens que faltam: do site, se baixou; senão, do próprio arquivo
    let mut saved_any = false;
    for m in f.items.iter().filter_map(|i| i.message.as_ref()) {
        if find_variant(conn, &m.source, &m.source_id)?.is_some() {
            continue;
        }
        if let Some(rows) = downloaded.get(&m.source_id).filter(|r| !r.is_empty()) {
            let first = &rows[0];
            let title = TdfTitle {
                title: if first.title.is_empty() { m.title.clone() } else { first.title.clone() },
                place: if first.place.is_empty() { m.local.clone() } else { first.place.clone() },
                date: if first.date.is_empty() { m.date_key.replace('-', "") } else { first.date.clone() },
                translation: if first.translation.is_empty() { m.translation.clone() } else { first.translation.clone() },
                code: m.source_id.clone(),
                version: first.version,
            };
            if messages::save_tdf_message(conn, &title, rows, false)? {
                rep.messages_downloaded += 1;
                saved_any = true;
                continue;
            }
        }
        if m.paragraphs.is_empty() || m.date_key.is_empty() {
            continue;
        }
        // grupo próprio "~…" e fontes sem sufixo: o encaixe decide de novo neste PC
        let suffix = if m.source == "local" && !m.suffix.starts_with('~') { m.suffix.clone() } else { String::new() };
        let tx = conn.transaction()?;
        messages::save_variant(
            &tx,
            &NewVariant {
                source: m.source.as_str(),
                source_id: m.source_id.clone(),
                date_key: m.date_key.clone(),
                suffix,
                translation: m.translation.clone(),
                title: m.title.clone(),
                local: m.local.clone(),
                pdf_url: m.pdf_url.clone(),
                audio_url: m.audio_url.clone(),
                page_url: m.page_url.clone(),
                paragraphs: m.paragraphs.clone(),
            },
        )?;
        tx.commit()?;
        rep.messages_from_file += 1;
        saved_any = true;
    }
    if saved_any {
        messages::tidy_groups(conn)?;
    }

    // 2) itens com as referências deste PC
    let mut items: Vec<PlaylistItem> = vec![];
    for it in &f.items {
        let r = match it.kind.as_str() {
            "song" => match &it.song {
                Some(s) => json!({ "id": upsert_song(conn, s, &mut rep)? }),
                None => {
                    rep.missing.push(it.label.clone());
                    continue;
                }
            },
            "text" => match &it.text {
                Some(t) => json!({ "id": upsert_text(conn, t, &mut rep)? }),
                None => {
                    rep.missing.push(it.label.clone());
                    continue;
                }
            },
            "message" => {
                let found = match &it.message {
                    Some(m) => find_variant(conn, &m.source, &m.source_id)?.map(|v| (v, m.num)),
                    None => None,
                };
                let Some(((vid, gid), num)) = found else {
                    rep.missing.push(it.label.clone());
                    continue;
                };
                let seq: Option<i64> = match num {
                    Some(n) => conn.query_row("SELECT seq FROM msg_paragraphs WHERE variant_id=?1 AND num=?2 ORDER BY seq LIMIT 1", params![vid, n], |x| x.get(0)).optional()?,
                    None => None,
                };
                json!({ "groupId": gid, "variantId": vid, "seq": seq, "num": num })
            }
            "media" => {
                if let Some(p) = it.r#ref["path"].as_str() {
                    if !std::path::Path::new(p).exists() {
                        rep.missing.push(format!("{} (arquivo não existe neste PC)", it.label));
                    }
                }
                it.r#ref.clone()
            }
            _ => it.r#ref.clone(),
        };
        items.push(PlaylistItem { kind: it.kind.clone(), r#ref: r.to_string(), label: it.label.clone() });
    }

    // 3) a lista: atualiza a importada antes ou cria uma nova
    let previous = match imports.get(&f.id) {
        Some(&id) => conn.query_row("SELECT id FROM playlists WHERE id=?1", [id], |r| r.get::<_, i64>(0)).optional()?,
        None => None,
    };
    let pid = match previous {
        Some(id) => {
            rep.updated = true;
            id
        }
        None => {
            let taken: bool = conn.query_row("SELECT count(*) FROM playlists WHERE name=?1", [&f.name], |r| r.get::<_, i64>(0))? > 0;
            let name = if taken { format!("{} (de {})", f.name, if f.from.is_empty() { "outro PC" } else { &f.from }) } else { f.name.clone() };
            let id = songs::create_playlist(conn, &name)?;
            imports.insert(f.id.clone(), id);
            id
        }
    };
    songs::set_playlist_items(conn, pid, &items)?;
    rep.playlist_id = pid;
    rep.name = conn.query_row("SELECT name FROM playlists WHERE id=?1", [pid], |r| r.get(0))?;
    rep.items = items.len();
    Ok(rep)
}

/// Mesma música (título e artista): fica com a letra do arquivo; senão cria.
fn upsert_song(conn: &Connection, s: &Song, rep: &mut FilaReport) -> Result<i64> {
    let found: Option<Song> = {
        let mut st = conn.prepare("SELECT id FROM songs")?;
        let ids: Vec<i64> = st.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        ids.into_iter().filter_map(|id| songs::get(conn, id).ok()).find(|x| fold(x.title.trim()) == fold(s.title.trim()) && fold(x.artist.trim()) == fold(s.artist.trim()))
    };
    let theme_ok = |t: Option<i64>| -> Result<Option<i64>> {
        Ok(match t {
            Some(id) => conn.query_row("SELECT id FROM themes WHERE id=?1", [id], |r| r.get(0)).optional()?,
            None => None,
        })
    };
    match found {
        Some(cur) => {
            let same = cur.lyrics == s.lyrics && cur.paragraph_order == s.paragraph_order && cur.author == s.author && cur.note == s.note && cur.copyright == s.copyright;
            if !same {
                let mut upd = s.clone();
                upd.id = cur.id;
                upd.play_count = cur.play_count;
                upd.theme_id = theme_ok(s.theme_id)?.or(cur.theme_id);
                songs::save(conn, &upd)?;
                rep.songs_updated += 1;
            }
            Ok(cur.id)
        }
        None => {
            let mut new = s.clone();
            new.id = 0;
            new.theme_id = theme_ok(s.theme_id)?;
            rep.songs_new += 1;
            songs::save(conn, &new)
        }
    }
}

/// Mesmo título: fica com o texto do arquivo; senão cria.
fn upsert_text(conn: &Connection, t: &TextDoc, rep: &mut FilaReport) -> Result<i64> {
    let found: Option<(i64, String)> = {
        let mut st = conn.prepare("SELECT id, title, body FROM texts")?;
        let rows: Vec<(i64, String, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<std::result::Result<_, _>>()?;
        rows.into_iter().find(|(_, title, _)| fold(title.trim()) == fold(t.title.trim())).map(|(id, _, body)| (id, body))
    };
    match found {
        Some((id, body)) => {
            if body != t.body {
                songs::save_text(conn, &TextDoc { id, ..t.clone() })?;
                rep.texts_updated += 1;
            }
            Ok(id)
        }
        None => {
            rep.texts_new += 1;
            songs::save_text(conn, &TextDoc { id: 0, ..t.clone() })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        c
    }

    fn variant(c: &mut Connection, source: &'static str, id: &str, dk: &str, sfx: &str, title: &str, paras: &[&str]) {
        let tx = c.transaction().unwrap();
        messages::save_variant(
            &tx,
            &NewVariant {
                source,
                source_id: id.into(),
                date_key: dk.into(),
                suffix: sfx.into(),
                translation: "GVD".into(),
                title: title.into(),
                local: "Jeffersonville".into(),
                pdf_url: String::new(),
                audio_url: String::new(),
                page_url: String::new(),
                paragraphs: paras.iter().enumerate().map(|(i, t)| (i as u32 + 1, t.to_string())).collect(),
            },
        )
        .unwrap();
        tx.commit().unwrap();
    }

    #[test]
    fn export_and_import_between_pcs() {
        // PC A: música, versículo, mensagem do banco local e do Tabernáculo da Fé
        let mut a = db();
        let song = Song { title: "Hino de Teste".into(), artist: "Coro".into(), lyrics: "Primeira estrofe\n\nRefrão".into(), ..Default::default() };
        let sid = songs::save(&a, &song).unwrap();
        variant(&mut a, "local", "7", "1965-1207", "", "Liderança", &["um", "dois", "três"]);
        variant(&mut a, "tdf", "WMBAAA", "1965-1204", "", "O Arrebatamento", &["primeiro", "segundo"]);
        let (va, ga): (i64, i64) = a.query_row("SELECT id, group_id FROM msg_variants WHERE source='local'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        let (vt, gt): (i64, i64) = a.query_row("SELECT id, group_id FROM msg_variants WHERE source='tdf'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        let pid = songs::create_playlist(&a, "DOM, 18/10/2026").unwrap();
        let item = |kind: &str, r: Value, label: &str| PlaylistItem { kind: kind.into(), r#ref: r.to_string(), label: label.into() };
        songs::set_playlist_items(
            &mut a,
            pid,
            &[
                item("song", json!({ "id": sid }), "Hino de Teste"),
                item("verse", json!({ "book": 43, "chapter": 3, "verse": 16, "bible": "acf" }), "João 3:16 — ACF"),
                item("message", json!({ "groupId": ga, "variantId": va, "seq": 2, "num": 3 }), "65-1207 Liderança — §3"),
                item("message", json!({ "groupId": gt, "variantId": vt, "seq": null }), "65-1204 O Arrebatamento"),
            ],
        )
        .unwrap();
        let file = export(&a, pid, "PC-A").unwrap();
        let json_text = serde_json::to_string(&file).unwrap();
        let file: FilaFile = serde_json::from_str(&json_text).unwrap();
        assert_eq!(file.items.len(), 4);
        assert_eq!(file.items[2].message.as_ref().unwrap().num, Some(3));

        // PC B: já tem a mensagem do banco local (outro id) e uma lista com o mesmo nome; não tem a do site
        let mut b = db();
        variant(&mut b, "local", "1", "1960-0101", "", "Outra", &["x"]);
        variant(&mut b, "local", "7", "1965-1207", "", "Liderança", &["um", "dois", "três"]);
        songs::create_playlist(&b, "DOM, 18/10/2026").unwrap();
        let mut imports = HashMap::new();
        // o site "manda" a mensagem que falta
        let mut down = HashMap::new();
        down.insert(
            "WMBAAA".to_string(),
            vec![
                TdfParagraph { paragraph: 1, text: "primeiro (revisado)".into(), title: "O ARREBATAMENTO".into(), date: "19651204".into(), translation: "Gravações “A Voz de Deus”".into(), ..Default::default() },
                TdfParagraph { paragraph: 2, text: "segundo".into(), ..Default::default() },
            ],
        );
        assert_eq!(missing_tdf(&b, &file).unwrap(), vec!["WMBAAA".to_string()]);
        let rep = import(&mut b, &file, &down, &mut imports).unwrap();
        assert_eq!((rep.items, rep.songs_new, rep.messages_downloaded, rep.messages_from_file, rep.updated), (4, 1, 1, 0, false), "{rep:?}");
        assert_eq!(rep.name, "DOM, 18/10/2026 (de PC-A)");
        let its = songs::playlist_items(&b, rep.playlist_id).unwrap();
        let m: Value = serde_json::from_str(&its[2].r#ref).unwrap();
        let (vb, gb): (i64, i64) = b.query_row("SELECT id, group_id FROM msg_variants WHERE source='local' AND source_id='7'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((m["variantId"].as_i64(), m["groupId"].as_i64(), m["seq"].as_i64()), (Some(vb), Some(gb), Some(2)), "ids deste PC e o mesmo §");
        let t: Value = serde_json::from_str(&its[3].r#ref).unwrap();
        let text: String = b.query_row("SELECT text FROM msg_paragraphs WHERE variant_id=?1 ORDER BY seq LIMIT 1", [t["variantId"].as_i64().unwrap()], |r| r.get(0)).unwrap();
        assert_eq!(text, "primeiro (revisado)", "baixada do site");
        assert_eq!(its[1].r#ref, json!({ "book": 43, "chapter": 3, "verse": 16, "bible": "acf" }).to_string());

        // de novo, com a letra mudada no PC A: atualiza a mesma lista e a música, sem criar outra
        let mut changed: FilaFile = serde_json::from_str(&json_text).unwrap();
        changed.items[0].song.as_mut().unwrap().lyrics = "Primeira estrofe\n\nRefrão novo".into();
        changed.items.truncate(3);
        let rep2 = import(&mut b, &changed, &HashMap::new(), &mut imports).unwrap();
        assert!(rep2.updated);
        assert_eq!((rep2.playlist_id, rep2.items, rep2.songs_new, rep2.songs_updated), (rep.playlist_id, 3, 0, 1));
        let n: i64 = b.query_row("SELECT count(*) FROM songs", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);

        // PC C sem internet e sem as mensagens: grava a partir do arquivo
        let mut c = db();
        let rep3 = import(&mut c, &file, &HashMap::new(), &mut HashMap::new()).unwrap();
        assert_eq!((rep3.items, rep3.messages_from_file, rep3.missing.len()), (4, 2, 0), "{rep3:?}");
        let code: String = c.query_row("SELECT g.code FROM msg_groups g JOIN msg_variants v ON v.group_id=g.id WHERE v.source='local'", [], |r| r.get(0)).unwrap();
        assert_eq!(code, "65-1207");
    }
}
