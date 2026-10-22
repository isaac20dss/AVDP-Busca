//! Banco do plugin: cópia só com as Mensagens do `avdp.db`, numa pasta fixa fora da biblioteca do
//! Holyrics (decisão do Isaac, 2026-10-18). Aberto só para leitura.

use crate::args::Args;
use crate::db::Result;
use crate::error::AppError;
use crate::search::Vocab;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const DEFAULT_DIR: &str = r"C:\AVDP Holyrics";
pub const DB_NAME: &str = "avdp-mensagens.db";

/// `--db` > variável `AVDP_PLUGIN_DB` > `C:\AVDP Holyrics\avdp-mensagens.db` > ao lado do programa.
pub fn db_path(a: &Args) -> PathBuf {
    if let Some(p) = a.get("db") {
        return PathBuf::from(p.trim());
    }
    if let Ok(p) = std::env::var("AVDP_PLUGIN_DB") {
        if !p.trim().is_empty() {
            return PathBuf::from(p.trim());
        }
    }
    let fixed = Path::new(DEFAULT_DIR).join(DB_NAME);
    if !fixed.exists() {
        if let Some(side) = std::env::current_exe().ok().map(|e| e.with_file_name(DB_NAME)).filter(|p| p.exists()) {
            return side;
        }
    }
    fixed
}

fn side_file(path: &Path, ext: &str) -> PathBuf {
    PathBuf::from(format!("{}{ext}", path.display()))
}

/// `file:` URI do SQLite (barras normais, `%HH` para o que não é letra/número/`-._~/:`).
fn sqlite_uri(path: &Path, query: &str) -> String {
    let p = path.display().to_string().replace('\\', "/");
    let mut out = String::from("file:");
    if !p.starts_with('/') {
        out.push_str("///");
    }
    for b in p.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~/:".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    format!("{out}?{query}")
}

/// Só leitura sem deixar nada ao lado do banco: sem `-wal`/`-journal` (ninguém gravando, como o
/// AVDP fechado) abre como imutável e não cria `-shm`/`-wal`; com eles, leitura normal do WAL.
pub fn open_read_only(path: &Path) -> Result<Connection> {
    let busy = !matches!(
        (side_file(path, "-wal").exists(), side_file(path, "-journal").exists()),
        (false, false)
    );
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI;
    let conn = if busy { Connection::open_with_flags(path, flags)? } else { Connection::open_with_flags(sqlite_uri(path, "immutable=1"), flags)? };
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    Ok(conn)
}

pub fn has_table(conn: &Connection, name: &str) -> Result<bool> {
    Ok(conn.query_row("SELECT count(*) FROM sqlite_master WHERE name=?1", [name], |r| r.get::<_, i64>(0))? > 0)
}

/// Abre só para leitura (nada é gravado, nem o `-shm` quando o banco não é WAL).
pub fn open(a: &Args) -> Result<(Connection, PathBuf)> {
    let path = db_path(a);
    if !path.is_file() {
        return Err(AppError::msg(format!("banco das mensagens não encontrado: {} (veja o LEIA-ME do plugin)", path.display())));
    }
    let conn = open_read_only(&path)?;
    if !has_table(&conn, "msg_groups")? || !has_table(&conn, "msg_fts")? {
        return Err(AppError::msg(format!("este banco não tem as Mensagens do AVDP: {}", path.display())));
    }
    Ok((conn, path))
}

/// Vocabulário do índice para variações, aproximada, curingas e pesos (a lista pronta do plugin
/// ou, no banco do AVDP, o `msg_fts_vocab`).
pub fn vocab(conn: &Connection) -> Result<Vocab> {
    let table = if has_table(conn, "plugin_vocab")? { "plugin_vocab" } else { "msg_fts_vocab" };
    let mut st = conn.prepare(&format!("SELECT term, doc FROM {table}"))?;
    let counts: Vec<(String, u64)> = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64)))?.filter_map(|r| r.ok()).collect();
    let total: i64 = conn.query_row("SELECT count(*) FROM msg_paragraphs", [], |r| r.get(0))?;
    Ok(Vocab::from_counts(counts, total as u64))
}

pub fn meta(conn: &Connection) -> Result<Value> {
    let mut out = serde_json::Map::new();
    if has_table(conn, "plugin_meta")? {
        let mut st = conn.prepare("SELECT key, value FROM plugin_meta")?;
        for r in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (k, v) = r?;
            out.insert(k, Value::String(v));
        }
    }
    Ok(Value::Object(out))
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// Gera o banco do plugin a partir de um `avdp.db`: cópia consistente (`VACUUM INTO`), fica só o
/// que é das Mensagens (+ versões e tamanho dos capítulos da Bíblia, para a fila, e o vocabulário
/// pronto), em modo DELETE para abrir só para leitura sem arquivos extras. O banco antigo do plugin
/// só é trocado depois da conferência.
pub fn make_db(from: &Path, to: &Path) -> Result<Value> {
    if !from.is_file() {
        return Err(AppError::msg(format!("banco do AVDP não encontrado: {}", from.display())));
    }
    if same_file(from, to) {
        return Err(AppError::msg("a origem e o destino são o mesmo arquivo"));
    }
    if let Some(dir) = to.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = to.with_extension("novo.db");
    for p in [tmp.clone(), PathBuf::from(format!("{}-journal", tmp.display()))] {
        if p.exists() {
            std::fs::remove_file(&p)?;
        }
    }
    {
        let src = open_read_only(from)?;
        if !has_table(&src, "msg_groups")? {
            return Err(AppError::msg(format!("este banco não tem as Mensagens do AVDP: {}", from.display())));
        }
        src.execute("VACUUM INTO ?1", [tmp.to_string_lossy().as_ref()])?;
    }
    let result = (|| -> Result<Value> {
        let c = Connection::open(&tmp)?;
        c.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=OFF;")?;
        c.execute_batch(
            "BEGIN;
             CREATE TABLE plugin_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE plugin_vocab(term TEXT PRIMARY KEY, doc INTEGER NOT NULL) WITHOUT ROWID;
             INSERT INTO plugin_vocab SELECT term, doc FROM msg_fts_vocab;
             COMMIT;",
        )?;
        if has_table(&c, "bibles")? {
            c.execute_batch("CREATE TABLE plugin_bibles AS SELECT id, name, abbrev, language FROM bibles;")?;
        }
        if has_table(&c, "verses")? {
            c.execute_batch(
                "CREATE TABLE plugin_chapters AS SELECT bible_id, book, chapter, max(verse) AS n FROM verses GROUP BY bible_id, book, chapter;
                 CREATE INDEX plugin_chapters_bc ON plugin_chapters(book, chapter);",
            )?;
        }
        // fora: tudo que não é das Mensagens (virtuais primeiro: levam as tabelas-sombra junto)
        let keep = |n: &str| n.starts_with("msg_") || n.starts_with("plugin_") || n.starts_with("sqlite_") || n == "meta";
        let virtuals: Vec<String> = {
            let mut st = c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE 'CREATE VIRTUAL%'")?;
            st.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?
        };
        // vocabulário antes do índice que ele lê
        let mut virtuals: Vec<String> = virtuals.into_iter().filter(|n| !keep(n)).collect();
        virtuals.sort_by_key(|n| !n.ends_with("_vocab"));
        for n in virtuals {
            c.execute_batch(&format!("DROP TABLE IF EXISTS \"{n}\";"))?;
        }
        let tables: Vec<String> = {
            let mut st = c.prepare("SELECT name FROM sqlite_master WHERE type='table'")?;
            st.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?
        };
        for n in tables.into_iter().filter(|n| !keep(n)) {
            c.execute_batch(&format!("DROP TABLE IF EXISTS \"{n}\";"))?;
        }
        let count = |sql: &str| -> Result<i64> { Ok(c.query_row(sql, [], |r| r.get(0))?) };
        let groups = count("SELECT count(*) FROM msg_groups")?;
        let variants = count("SELECT count(*) FROM msg_variants WHERE para_count > 0 AND superseded_by IS NULL")?;
        let paragraphs = count("SELECT count(*) FROM msg_paragraphs")?;
        if paragraphs == 0 {
            return Err(AppError::msg("o banco de origem não tem parágrafos de mensagens"));
        }
        for (k, v) in [
            ("made_at", now().to_string()),
            ("from", from.display().to_string()),
            ("tool", format!("avdp-consulta {}", env!("CARGO_PKG_VERSION"))),
            ("groups", groups.to_string()),
            ("variants_with_text", variants.to_string()),
            ("paragraphs", paragraphs.to_string()),
        ] {
            c.execute("INSERT OR REPLACE INTO plugin_meta VALUES (?1, ?2)", [k, v.as_str()])?;
        }
        c.execute_batch("VACUUM;")?;
        let check: String = c.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if check != "ok" {
            return Err(AppError::msg(format!("conferência do banco novo falhou: {check}")));
        }
        // o índice responde (com a palavra mais comum do vocabulário)
        let term: String = c.query_row("SELECT term FROM plugin_vocab ORDER BY doc DESC LIMIT 1", [], |r| r.get(0))?;
        let hit: Option<i64> =
            c.query_row("SELECT rowid FROM msg_fts WHERE msg_fts MATCH ?1 LIMIT 1", [format!("\"{}\"", term.replace('"', ""))], |r| r.get(0)).optional()?;
        if hit.is_none() {
            return Err(AppError::msg("o índice de busca do banco novo não respondeu"));
        }
        Ok(json!({ "groups": groups, "variants_with_text": variants, "paragraphs": paragraphs }))
    })();
    let info = match result {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    };
    std::fs::rename(&tmp, to).map_err(|e| AppError::msg(format!("não deu para trocar o banco do plugin ({e}); feche o Holyrics e tente de novo")))?;
    let size = std::fs::metadata(to).map(|m| m.len()).unwrap_or(0);
    let mut out = info;
    out["db"] = Value::String(to.display().to_string());
    out["size_mb"] = json!((size as f64 / 1_048_576.0 * 10.0).round() / 10.0);
    Ok(out)
}
