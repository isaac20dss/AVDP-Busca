//! Temas de projeção (JSON livre, interpretado no front).

use crate::db::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Theme {
    pub id: i64,
    pub name: String,
    /// JSON do tema (fundo, fonte, tamanho, cores, alinhamento, sombra, contorno, rodapé).
    pub data: String,
}

const DEFAULTS: &[(&str, &str)] = &[
    (
        "Clássico escuro",
        r##"{"bg":{"kind":"color","color":"#000000"},"font":"Montserrat","size":7,"color":"#ffffff","bold":true,"italic":false,"uppercase":false,"align":"center","valign":"middle","lineHeight":1.3,"shadow":true,"outline":0,"outlineColor":"#000000","padding":6,"footer":{"show":true,"size":3,"color":"#d0d0d0"}}"##,
    ),
    (
        "Madeira",
        r##"{"bg":{"kind":"gradient","gradient":"radial-gradient(ellipse at center, #3a2a1c 0%, #140d08 75%)"},"font":"Montserrat","size":7,"color":"#ffffff","bold":true,"italic":false,"uppercase":false,"align":"center","valign":"middle","lineHeight":1.3,"shadow":true,"outline":0,"outlineColor":"#000000","padding":6,"footer":{"show":true,"size":3,"color":"#e8d8c0"}}"##,
    ),
    (
        "Noite azul",
        r##"{"bg":{"kind":"gradient","gradient":"linear-gradient(160deg, #0b1d3a 0%, #102f5c 50%, #071226 100%)"},"font":"Lato","size":7,"color":"#ffffff","bold":true,"italic":false,"uppercase":false,"align":"center","valign":"middle","lineHeight":1.3,"shadow":true,"outline":0,"outlineColor":"#000000","padding":6,"footer":{"show":true,"size":3,"color":"#bcd3f5"}}"##,
    ),
    (
        "Leitura (Bíblia/Mensagem)",
        r##"{"bg":{"kind":"gradient","gradient":"linear-gradient(180deg, #1b1b1f 0%, #0d0d10 100%)"},"font":"Merriweather","size":5.4,"color":"#f5f1e8","bold":false,"italic":false,"uppercase":false,"align":"justify","valign":"middle","lineHeight":1.45,"shadow":true,"outline":0,"outlineColor":"#000000","padding":7,"footer":{"show":true,"size":2.8,"color":"#f0c674"}}"##,
    ),
    (
        "Claro",
        r##"{"bg":{"kind":"color","color":"#f7f4ec"},"font":"Lato","size":7,"color":"#1d1d1d","bold":true,"italic":false,"uppercase":false,"align":"center","valign":"middle","lineHeight":1.3,"shadow":false,"outline":0,"outlineColor":"#ffffff","padding":6,"footer":{"show":true,"size":3,"color":"#5a5a5a"}}"##,
    ),
    (
        "Faixa inferior (OBS / chroma)",
        r##"{"bg":{"kind":"color","color":"#00b140"},"font":"Montserrat","size":5,"color":"#ffffff","bold":true,"italic":false,"uppercase":false,"align":"center","valign":"bottom","lineHeight":1.25,"shadow":true,"outline":3,"outlineColor":"#000000","padding":5,"band":true,"footer":{"show":true,"size":2.6,"color":"#ffffff"}}"##,
    ),
];

pub fn seed_defaults(conn: &Connection) -> Result<()> {
    let n: i64 = conn.query_row("SELECT count(*) FROM themes", [], |r| r.get(0))?;
    if n == 0 {
        for (name, data) in DEFAULTS {
            conn.execute("INSERT INTO themes(name, data) VALUES (?1, ?2)", params![name, data])?;
        }
    }
    Ok(())
}

pub fn list(conn: &Connection) -> Result<Vec<Theme>> {
    let mut st = conn.prepare("SELECT id, name, data FROM themes ORDER BY id")?;
    let rows = st.query_map([], |r| Ok(Theme { id: r.get(0)?, name: r.get(1)?, data: r.get(2)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn save(conn: &Connection, t: &Theme) -> Result<i64> {
    if t.id > 0 {
        conn.execute("UPDATE themes SET name=?2, data=?3 WHERE id=?1", params![t.id, t.name, t.data])?;
        Ok(t.id)
    } else {
        conn.execute("INSERT INTO themes(name, data) VALUES (?1, ?2)", params![t.name, t.data])?;
        Ok(conn.last_insert_rowid())
    }
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM themes WHERE id=?1", [id])?;
    Ok(())
}
