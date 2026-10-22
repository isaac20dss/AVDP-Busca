//! Banco SQLite do app e migrações.

use rusqlite::{Connection, OptionalExtension};
use std::path::Path;

pub type Result<T> = std::result::Result<T, crate::error::AppError>;

const TOKENIZE: &str = "tokenize='unicode61 remove_diacritics 2'";

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;")?;
    migrate(&conn)?;
    Ok(conn)
}

fn version(conn: &Connection) -> Result<i64> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)")?;
    let v: Option<String> =
        conn.query_row("SELECT value FROM meta WHERE key='schema'", [], |r| r.get(0)).optional()?;
    Ok(v.and_then(|s| s.parse().ok()).unwrap_or(0))
}

fn fts_with_triggers(table: &str, fts: &str, cols: &[&str]) -> String {
    let list = cols.join(", ");
    format!(
        "CREATE VIRTUAL TABLE {fts} USING fts5({list}, content='{table}', content_rowid='id', {TOKENIZE});
         CREATE VIRTUAL TABLE {fts}_vocab USING fts5vocab({fts}, row);
         {}",
        fts_triggers(table, fts, cols)
    )
}

/// Gatilhos que mantêm o índice FTS em dia com a tabela.
pub fn fts_triggers(table: &str, fts: &str, cols: &[&str]) -> String {
    let list = cols.join(", ");
    let new_vals = cols.iter().map(|c| format!("new.{c}")).collect::<Vec<_>>().join(", ");
    let old_vals = cols.iter().map(|c| format!("old.{c}")).collect::<Vec<_>>().join(", ");
    format!(
        "CREATE TRIGGER {table}_ai AFTER INSERT ON {table} BEGIN
           INSERT INTO {fts}(rowid, {list}) VALUES (new.id, {new_vals});
         END;
         CREATE TRIGGER {table}_ad AFTER DELETE ON {table} BEGIN
           INSERT INTO {fts}({fts}, rowid, {list}) VALUES ('delete', old.id, {old_vals});
         END;
         CREATE TRIGGER {table}_au AFTER UPDATE ON {table} BEGIN
           INSERT INTO {fts}({fts}, rowid, {list}) VALUES ('delete', old.id, {old_vals});
           INSERT INTO {fts}(rowid, {list}) VALUES (new.id, {new_vals});
         END;"
    )
}

pub fn migrate(conn: &Connection) -> Result<()> {
    let v = version(conn)?;
    if v < 1 {
        let mut sql = String::from(
            "BEGIN;
            CREATE TABLE songs(
              id INTEGER PRIMARY KEY,
              title TEXT NOT NULL,
              artist TEXT NOT NULL DEFAULT '',
              author TEXT NOT NULL DEFAULT '',
              note TEXT NOT NULL DEFAULT '',
              lyrics TEXT NOT NULL DEFAULT '',
              paragraph_order TEXT NOT NULL DEFAULT '',
              copyright TEXT NOT NULL DEFAULT '',
              source TEXT NOT NULL DEFAULT '',
              theme_id INTEGER,
              play_count INTEGER NOT NULL DEFAULT 0,
              last_played INTEGER,
              created_at INTEGER NOT NULL DEFAULT (unixepoch()),
              updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE TABLE texts(
              id INTEGER PRIMARY KEY,
              title TEXT NOT NULL,
              body TEXT NOT NULL DEFAULT '',
              source TEXT NOT NULL DEFAULT '',
              created_at INTEGER NOT NULL DEFAULT (unixepoch()),
              updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE TABLE bibles(
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              abbrev TEXT NOT NULL,
              language TEXT NOT NULL DEFAULT 'pt',
              license TEXT NOT NULL DEFAULT '',
              source TEXT NOT NULL DEFAULT '',
              sort INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE verses(
              id INTEGER PRIMARY KEY,
              bible_id TEXT NOT NULL REFERENCES bibles(id) ON DELETE CASCADE,
              book INTEGER NOT NULL,
              chapter INTEGER NOT NULL,
              verse INTEGER NOT NULL,
              text TEXT NOT NULL,
              UNIQUE(bible_id, book, chapter, verse)
            );
            CREATE TABLE msg_groups(
              id INTEGER PRIMARY KEY,
              date_key TEXT NOT NULL,
              suffix TEXT NOT NULL DEFAULT '',
              code TEXT NOT NULL,
              year INTEGER NOT NULL,
              title TEXT NOT NULL DEFAULT '',
              local TEXT NOT NULL DEFAULT '',
              preferred_variant INTEGER,
              chosen INTEGER NOT NULL DEFAULT 0,
              UNIQUE(date_key, suffix)
            );
            CREATE TABLE msg_variants(
              id INTEGER PRIMARY KEY,
              group_id INTEGER NOT NULL REFERENCES msg_groups(id) ON DELETE CASCADE,
              source TEXT NOT NULL,
              source_id TEXT NOT NULL,
              translation TEXT NOT NULL DEFAULT '',
              title TEXT NOT NULL DEFAULT '',
              title_fold TEXT NOT NULL DEFAULT '',
              local TEXT NOT NULL DEFAULT '',
              local_fold TEXT NOT NULL DEFAULT '',
              pdf_url TEXT NOT NULL DEFAULT '',
              audio_url TEXT NOT NULL DEFAULT '',
              page_url TEXT NOT NULL DEFAULT '',
              para_count INTEGER NOT NULL DEFAULT 0,
              UNIQUE(source, source_id)
            );
            CREATE INDEX msg_variants_group ON msg_variants(group_id);
            CREATE TABLE msg_paragraphs(
              id INTEGER PRIMARY KEY,
              variant_id INTEGER NOT NULL REFERENCES msg_variants(id) ON DELETE CASCADE,
              num INTEGER NOT NULL,
              seq INTEGER NOT NULL,
              text TEXT NOT NULL
            );
            CREATE INDEX msg_paragraphs_variant ON msg_paragraphs(variant_id, seq);
            CREATE TABLE playlists(
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              created_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE TABLE playlist_items(
              id INTEGER PRIMARY KEY,
              playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
              pos INTEGER NOT NULL,
              kind TEXT NOT NULL,
              ref TEXT NOT NULL,
              label TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE themes(
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL,
              data TEXT NOT NULL
            );
            CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE search_history(
              id INTEGER PRIMARY KEY,
              scope TEXT NOT NULL,
              query TEXT NOT NULL,
              opts TEXT NOT NULL DEFAULT '{}',
              hits INTEGER NOT NULL DEFAULT 0,
              at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            ",
        );
        sql.push_str(&fts_with_triggers("songs", "songs_fts", &["title", "artist", "lyrics"]));
        sql.push_str(&fts_with_triggers("texts", "texts_fts", &["title", "body"]));
        sql.push_str(&fts_with_triggers("verses", "verses_fts", &["text"]));
        sql.push_str(&fts_with_triggers("msg_paragraphs", "msg_fts", &["text"]));
        sql.push_str("INSERT OR REPLACE INTO meta VALUES ('schema', '1'); COMMIT;");
        conn.execute_batch(&sql)?;
        crate::themes::seed_defaults(conn)?;
    }
    if v < 2 {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE IF NOT EXISTS media(
               id INTEGER PRIMARY KEY,
               path TEXT NOT NULL UNIQUE,
               name TEXT NOT NULL,
               kind TEXT NOT NULL,
               folder TEXT NOT NULL DEFAULT '',
               size INTEGER NOT NULL DEFAULT 0,
               added_at INTEGER NOT NULL DEFAULT (unixepoch())
             );
             INSERT OR REPLACE INTO meta VALUES ('schema', '2');
             COMMIT;",
        )?;
    }
    if v < 3 {
        // cópia antiga de uma mensagem que o Tabernáculo da Fé traz revisada (mesma tradução)
        conn.execute_batch(
            "BEGIN;
             ALTER TABLE msg_variants ADD COLUMN superseded_by INTEGER;
             INSERT OR REPLACE INTO meta VALUES ('schema', '3');
             COMMIT;",
        )?;
    }
    if v < 4 {
        // mensagem editada pelo operador: a sincronização não sobrescreve; o original fica guardado para desfazer
        conn.execute_batch(
            "BEGIN;
             ALTER TABLE msg_variants ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
             CREATE TABLE IF NOT EXISTS msg_backup(variant_id INTEGER NOT NULL, num INTEGER NOT NULL, seq INTEGER NOT NULL, text TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS msg_backup_variant ON msg_backup(variant_id);
             INSERT OR REPLACE INTO meta VALUES ('schema', '4');
             COMMIT;",
        )?;
    }
    if v < 5 {
        // pesquisa: liga o parágrafo achado à tradução sem ler o texto (palavra comum ficava ~1 s)
        conn.execute_batch(
            "BEGIN;
             CREATE INDEX IF NOT EXISTS msg_paragraphs_idvar ON msg_paragraphs(id, variant_id, num, seq);
             INSERT OR REPLACE INTO meta VALUES ('schema', '5');
             COMMIT;",
        )?;
    }
    Ok(())
}

/// Importação grande: desliga os gatilhos do FTS e reconstrói o índice uma vez no fim.
pub fn bulk_fts<T>(
    conn: &mut Connection,
    table: &str,
    fts: &str,
    cols: &[&str],
    work: impl FnOnce(&rusqlite::Transaction) -> Result<T>,
) -> Result<T> {
    let tx = conn.transaction()?;
    tx.execute_batch(&format!(
        "DROP TRIGGER IF EXISTS {table}_ai; DROP TRIGGER IF EXISTS {table}_ad; DROP TRIGGER IF EXISTS {table}_au;"
    ))?;
    let out = work(&tx)?;
    tx.execute_batch(&fts_triggers(table, fts, cols))?;
    tx.execute(&format!("INSERT INTO {fts}({fts}) VALUES ('rebuild')"), [])?;
    tx.commit()?;
    Ok(out)
}

/// Banco trazido de outro computador (ou outro usuário do Windows): os caminhos guardados para a
/// pasta de dados antiga (`…\br.avdp.busca\fundos\…`, papel de parede e fundo de tema) passam a
/// apontar para a pasta de dados atual. Devolve quantos registros mudaram.
pub fn relocate_data_dir(conn: &Connection, data_dir: &Path) -> Result<usize> {
    use once_cell::sync::Lazy;
    use regex::Regex;
    // dentro do JSON as barras vêm dobradas: C:\\Users\\X\\AppData\\Roaming\\br.avdp.busca\\
    static OLD: Lazy<Regex> = Lazy::new(|| Regex::new(r#"[A-Za-z]:(?:\\\\[^"\\]+)*?\\\\br\.avdp\.busca\\\\"#).unwrap());
    let here = format!("{}\\", data_dir.display()).replace('\\', "\\\\");
    let mut changed = 0;
    for (table, key, col) in [("settings", "key", "value"), ("themes", "id", "data")] {
        let rows: Vec<(String, String)> = {
            let mut st = conn.prepare(&format!("SELECT CAST({key} AS TEXT), {col} FROM {table} WHERE {col} LIKE '%br.avdp.busca%'"))?;
            let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for (k, text) in rows {
            let new = OLD.replace_all(&text, regex::NoExpand(&here));
            if new != text {
                conn.execute(&format!("UPDATE {table} SET {col}=?1 WHERE CAST({key} AS TEXT)=?2"), [new.as_ref(), k.as_str()])?;
                changed += 1;
            }
        }
    }
    Ok(changed)
}

pub fn setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?1, ?2)", [key, value])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relocate_old_data_dir() {
        let c = Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        // como o app grava: JSON, com as barras dobradas
        let old = serde_json::json!({
            "monitor": 1,
            "wallpaperImage": r"C:\Users\Isaac\AppData\Roaming\br.avdp.busca\fundos\fundo tv2.jpg",
            "x": r"D:\outra\foto.jpg",
        })
        .to_string();
        set_setting(&c, "ui", &old).unwrap();
        let theme = serde_json::json!({ "bg": { "kind": "image", "image": r"C:\Users\Isaac\AppData\Roaming\br.avdp.busca\fundos\a b.png" } }).to_string();
        c.execute("UPDATE themes SET data=?1 WHERE id=(SELECT min(id) FROM themes)", [&theme]).unwrap();
        let n = relocate_data_dir(&c, Path::new(r"C:\Users\User\AppData\Roaming\br.avdp.busca")).unwrap();
        assert_eq!(n, 2);
        let ui = setting(&c, "ui").unwrap().unwrap();
        let v: serde_json::Value = serde_json::from_str(&ui).unwrap();
        assert_eq!(v["wallpaperImage"], r"C:\Users\User\AppData\Roaming\br.avdp.busca\fundos\fundo tv2.jpg");
        assert_eq!(v["x"], r"D:\outra\foto.jpg", "caminho fora da pasta de dados não muda");
        let t: String = c.query_row("SELECT data FROM themes WHERE id=(SELECT min(id) FROM themes)", [], |r| r.get(0)).unwrap();
        let tv: serde_json::Value = serde_json::from_str(&t).unwrap();
        assert_eq!(tv["bg"]["image"], r"C:\Users\User\AppData\Roaming\br.avdp.busca\fundos\a b.png");
        // de novo, nada muda
        assert_eq!(relocate_data_dir(&c, Path::new(r"C:\Users\User\AppData\Roaming\br.avdp.busca")).unwrap(), 0);
    }
}
