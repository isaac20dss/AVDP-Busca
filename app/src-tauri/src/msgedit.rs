//! Edição de mensagens pelo operador: corrigir o texto de um parágrafo e juntar um parágrafo ao
//! seguinte. A tradução editada fica marcada (`edited`): a sincronização não sobrescreve e ela não é
//! escondida como cópia antiga. O texto original fica guardado em `msg_backup` para desfazer.

use crate::db::Result;
use crate::error::AppError;
use crate::text::squash_spaces;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// Primeira edição da tradução: guarda o original e marca como editada.
fn begin(tx: &Transaction, vid: i64) -> Result<()> {
    let edited: Option<i64> = tx.query_row("SELECT edited FROM msg_variants WHERE id=?1", [vid], |r| r.get(0)).optional()?;
    match edited {
        None => Err(AppError::msg("tradução não encontrada")),
        Some(0) => {
            tx.execute("DELETE FROM msg_backup WHERE variant_id=?1", [vid])?;
            tx.execute("INSERT INTO msg_backup(variant_id, num, seq, text) SELECT variant_id, num, seq, text FROM msg_paragraphs WHERE variant_id=?1", [vid])?;
            tx.execute("UPDATE msg_variants SET edited=1 WHERE id=?1", [vid])?;
            Ok(())
        }
        Some(_) => Ok(()),
    }
}

fn recount(tx: &Transaction, vid: i64) -> Result<()> {
    tx.execute("UPDATE msg_variants SET para_count=(SELECT count(*) FROM msg_paragraphs WHERE variant_id=?1) WHERE id=?1", [vid])?;
    Ok(())
}

/// Troca o texto de um parágrafo (o índice de pesquisa acompanha pelos gatilhos).
pub fn save_paragraph(conn: &mut Connection, vid: i64, seq: i64, text: &str) -> Result<()> {
    let text = squash_spaces(text);
    if text.is_empty() {
        return Err(AppError::msg("o parágrafo não pode ficar vazio (para tirar, junte com o seguinte)"));
    }
    let tx = conn.transaction()?;
    begin(&tx, vid)?;
    let n = tx.execute("UPDATE msg_paragraphs SET text=?3 WHERE variant_id=?1 AND seq=?2", params![vid, seq, text])?;
    if n == 0 {
        return Err(AppError::msg("parágrafo não encontrado"));
    }
    tx.commit()?;
    Ok(())
}

/// Junta o parágrafo ao seguinte (fica o número deste). Devolve falso se era o último.
pub fn join_next(conn: &mut Connection, vid: i64, seq: i64) -> Result<bool> {
    let tx = conn.transaction()?;
    let cur: Option<(i64, String)> = tx
        .query_row("SELECT id, text FROM msg_paragraphs WHERE variant_id=?1 AND seq=?2", params![vid, seq], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let Some((id, text)) = cur else { return Err(AppError::msg("parágrafo não encontrado")) };
    let next: Option<(i64, String)> = tx
        .query_row(
            "SELECT id, text FROM msg_paragraphs WHERE variant_id=?1 AND seq>?2 ORDER BY seq LIMIT 1",
            params![vid, seq],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((next_id, next_text)) = next else { return Ok(false) };
    begin(&tx, vid)?;
    tx.execute("UPDATE msg_paragraphs SET text=?2 WHERE id=?1", params![id, squash_spaces(&format!("{text} {next_text}"))])?;
    tx.execute("DELETE FROM msg_paragraphs WHERE id=?1", [next_id])?;
    recount(&tx, vid)?;
    tx.commit()?;
    Ok(true)
}

/// Volta ao texto original (antes da primeira edição).
pub fn undo(conn: &mut Connection, vid: i64) -> Result<bool> {
    let tx = conn.transaction()?;
    let saved: i64 = tx.query_row("SELECT count(*) FROM msg_backup WHERE variant_id=?1", [vid], |r| r.get(0))?;
    if saved == 0 {
        tx.execute("UPDATE msg_variants SET edited=0 WHERE id=?1", [vid])?;
        tx.commit()?;
        return Ok(false);
    }
    tx.execute("DELETE FROM msg_paragraphs WHERE variant_id=?1", [vid])?;
    tx.execute("INSERT INTO msg_paragraphs(variant_id, num, seq, text) SELECT variant_id, num, seq, text FROM msg_backup WHERE variant_id=?1 ORDER BY seq", [vid])?;
    tx.execute("DELETE FROM msg_backup WHERE variant_id=?1", [vid])?;
    tx.execute("UPDATE msg_variants SET edited=0 WHERE id=?1", [vid])?;
    recount(&tx, vid)?;
    tx.commit()?;
    Ok(true)
}

/// Traduções editadas de um grupo.
pub fn edited_in_group(conn: &Connection, gid: i64) -> Result<Vec<i64>> {
    let mut st = conn.prepare("SELECT id FROM msg_variants WHERE group_id=?1 AND edited=1")?;
    let rows = st.query_map([gid], |r| r.get(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{self, NewVariant};

    #[test]
    fn edit_join_resync_and_undo() {
        let dir = std::env::temp_dir().join(format!("avdp-edit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = crate::db::open(&dir.join("t.db")).unwrap();
        let v = |paras: Vec<(u32, String)>| NewVariant {
            source: "cbb",
            source_id: "1".into(),
            date_key: "1947-0101".into(),
            suffix: String::new(),
            translation: "Crentes da Bíblia".into(),
            title: "Fé é a substância".into(),
            local: String::new(),
            pdf_url: String::new(),
            audio_url: String::new(),
            page_url: String::new(),
            paragraphs: paras,
        };
        let orig = vec![(1, "Primeiro texto.".to_string()), (2, "Como em minha cidade. Ora, não".to_string()), (3, "há nada ali.".to_string()), (4, "Fim.".to_string())];
        let vid = {
            let tx = conn.transaction().unwrap();
            let id = messages::save_variant(&tx, &v(orig.clone())).unwrap();
            tx.commit().unwrap();
            id
        };
        let seq_of = |c: &Connection, num: i64| -> i64 { c.query_row("SELECT seq FROM msg_paragraphs WHERE variant_id=?1 AND num=?2", params![vid, num], |r| r.get(0)).unwrap() };
        let (s1, s2) = (seq_of(&conn, 1), seq_of(&conn, 2));
        save_paragraph(&mut conn, vid, s1, "Primeiro  texto corrigido.").unwrap();
        assert!(join_next(&mut conn, vid, s2).unwrap());
        let texts: Vec<(i64, String)> = {
            let mut st = conn.prepare("SELECT num, text FROM msg_paragraphs WHERE variant_id=?1 ORDER BY seq").unwrap();
            st.query_map([vid], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|x| x.unwrap()).collect()
        };
        assert_eq!(texts, vec![(1, "Primeiro texto corrigido.".into()), (2, "Como em minha cidade. Ora, não há nada ali.".into()), (4, "Fim.".into())]);
        let count: i64 = conn.query_row("SELECT para_count FROM msg_variants WHERE id=?1", [vid], |r| r.get(0)).unwrap();
        assert_eq!(count, 3);
        // a pesquisa acha o texto corrigido
        let hits: i64 = conn.query_row("SELECT count(*) FROM msg_fts WHERE msg_fts MATCH 'corrigido'", [], |r| r.get(0)).unwrap();
        assert_eq!(hits, 1);
        // sincronizar de novo não desfaz a edição
        {
            let tx = conn.transaction().unwrap();
            messages::save_variant(&tx, &v(orig.clone())).unwrap();
            tx.commit().unwrap();
        }
        let n: i64 = conn.query_row("SELECT count(*) FROM msg_paragraphs WHERE variant_id=?1", [vid], |r| r.get(0)).unwrap();
        assert_eq!(n, 3);
        // desfazer volta ao original
        assert!(undo(&mut conn, vid).unwrap());
        let n: i64 = conn.query_row("SELECT count(*) FROM msg_paragraphs WHERE variant_id=?1", [vid], |r| r.get(0)).unwrap();
        let ed: i64 = conn.query_row("SELECT edited FROM msg_variants WHERE id=?1", [vid], |r| r.get(0)).unwrap();
        assert_eq!((n, ed), (4, 0));
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
