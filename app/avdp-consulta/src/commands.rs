//! Comandos do `avdp-consulta`. Cada um devolve um objeto JSON (o `main` acrescenta `ok` e `ms`).

use crate::args::Args;
use crate::db::Result;
use crate::error::AppError;
use crate::messages::{self, ListQuery, MsgSearch};
use crate::plugin_db;
use crate::search::{Mode, QueryOpts};
use crate::slides::chunk_text;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub fn run(a: &Args) -> Result<Value> {
    match a.cmd.as_str() {
        "info" => info(a),
        "search" => search(a),
        "group" => group(a),
        "paragraphs" => paragraphs(a),
        "filas" => crate::fila::list(a),
        "fila" => crate::fila::convert(a),
        "make-db" => {
            let from = a.get("from").ok_or_else(|| AppError::msg("falta --from <avdp.db>"))?;
            let to = a.get("to").map(PathBuf::from).unwrap_or_else(|| Path::new(plugin_db::DEFAULT_DIR).join(plugin_db::DB_NAME));
            plugin_db::make_db(Path::new(&from), &to)
        }
        // resposta de tamanho conhecido, para o módulo medir até onde a saída chega inteira
        "eco" => Ok(json!({ "pad": "a".repeat(a.num("bytes").unwrap_or(1000).clamp(0, 20_000_000) as usize) })),
        "version" | "help" => Ok(json!({ "version": env!("CARGO_PKG_VERSION"), "commands": ["info", "search", "group", "paragraphs", "filas", "fila", "make-db"] })),
        other => Err(AppError::msg(format!("comando desconhecido: {other}"))),
    }
}

/// Tamanho máximo do slide (`--chars`; 0 = parágrafo inteiro). Padrão do AVDP: 420.
pub fn chars(a: &Args) -> usize {
    match a.num("chars") {
        Some(n) if n <= 0 => usize::MAX,
        Some(n) => n.clamp(80, 5000) as usize,
        None => 420,
    }
}

fn info(a: &Args) -> Result<Value> {
    let (c, path) = plugin_db::open(a)?;
    let one = |sql: &str| -> Result<i64> { Ok(c.query_row(sql, [], |r| r.get(0))?) };
    let translations: Vec<(String, i64)> = {
        let mut st = c.prepare(
            "SELECT translation, count(*) FROM msg_variants WHERE para_count > 0 AND superseded_by IS NULL AND translation <> '' GROUP BY translation ORDER BY 2 DESC",
        )?;
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?
    };
    Ok(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "db": path.display().to_string(),
        "groups": one("SELECT count(*) FROM msg_groups")?,
        "with_text": one("SELECT count(DISTINCT group_id) FROM msg_variants WHERE para_count > 0 AND superseded_by IS NULL")?,
        "paragraphs": one("SELECT count(*) FROM msg_paragraphs")?,
        "year_min": c.query_row("SELECT min(year) FROM msg_groups WHERE year > 1900", [], |r| r.get::<_, Option<i64>>(0))?,
        "year_max": c.query_row("SELECT max(year) FROM msg_groups", [], |r| r.get::<_, Option<i64>>(0))?,
        "translations": translations,
        "meta": plugin_db::meta(&c)?,
    }))
}

/// Pesquisa como a aba Pesquisar do AVDP (sintaxe do The Table, modos, anos), sem as cópias escondidas.
fn search(a: &Args) -> Result<Value> {
    let q = a.get("q").ok_or_else(|| AppError::msg("digite o que procurar"))?;
    let (c, _) = plugin_db::open(a)?;
    let mode = match a.get("mode").unwrap_or_default().to_lowercase().as_str() {
        "any" | "qualquer" => Mode::Any,
        "exact" | "frase" => Mode::Exact,
        "near" | "proximas" | "próximas" => Mode::Near,
        _ => Mode::All,
    };
    let opts = QueryOpts {
        mode,
        whole_word: a.flag("whole-word"),
        variants: a.flag("variants"),
        fuzzy: a.flag("fuzzy"),
        near: a.num("near").unwrap_or(10).clamp(1, 100) as u32,
    };
    let ms = MsgSearch {
        query: q,
        opts,
        year_from: a.num("from"),
        year_to: a.num("to"),
        by_message: a.flag("by-message"),
        sort: a.get("sort").unwrap_or_default(),
        limit: a.num("limit").unwrap_or(60).clamp(1, 500) as u32,
        ..Default::default()
    };
    let vocab = plugin_db::vocab(&c)?;
    let r = messages::search_messages(&c, &vocab, &ms)?;
    Ok(json!({ "total": r.total, "terms": r.terms, "direct": r.direct, "hits": r.hits }))
}

/// Mensagens por código de data (65-1127B; sem a letra, o dia inteiro) ou por palavras do título,
/// cada uma com as traduções visíveis que têm texto (a escolhida no AVDP primeiro).
fn group(a: &Args) -> Result<Value> {
    let (c, _) = plugin_db::open(a)?;
    let ids: Vec<i64> = if let Some(id) = a.num("id") {
        vec![id]
    } else {
        let filter = a.get("code").or_else(|| a.get("filter")).ok_or_else(|| AppError::msg("digite o código da data (ex.: 65-1127B) ou parte do título"))?;
        let limit = a.num("limit").unwrap_or(80).clamp(1, 500) as u32;
        messages::list_groups(&c, &ListQuery { filter: filter.trim().to_string(), limit, ..Default::default() })?.rows.into_iter().map(|g| g.id).collect()
    };
    let mut groups = vec![];
    let mut without_text = 0;
    for id in ids {
        let Ok(g) = messages::group(&c, id) else { continue };
        let mut vs: Vec<&messages::VariantInfo> = g.variants.iter().filter(|v| v.para_count > 0 && v.superseded_by.is_none()).collect();
        if vs.is_empty() {
            without_text += 1;
            continue;
        }
        vs.sort_by_key(|v| Some(v.id) != g.preferred_variant);
        let mut st = c.prepare_cached("SELECT source_id FROM msg_variants WHERE id=?1")?;
        let mut variants: Vec<Value> = vec![];
        for v in vs {
            let source_id: String = st.query_row([v.id], |r| r.get(0))?;
            variants.push(json!({ "id": v.id, "source": v.source, "source_id": source_id, "translation": v.translation, "title": v.title, "local": v.local, "para_count": v.para_count }));
        }
        groups.push(json!({ "id": g.id, "code": g.code, "date_key": g.date_key, "title": g.title, "local": g.local, "preferred_variant": g.preferred_variant, "variants": variants }));
    }
    Ok(json!({ "groups": groups, "without_text": without_text }))
}

/// Variante pedida: pela fonte (estável entre bancos), pelo id ou pela escolhida do grupo; cópia
/// escondida passa para a revisão que a substitui.
fn resolve_variant(c: &Connection, a: &Args) -> Result<i64> {
    let mut vid: Option<i64> = None;
    if let (Some(src), Some(sid)) = (a.get("src"), a.get("src-id")) {
        vid = c.query_row("SELECT id FROM msg_variants WHERE source=?1 AND source_id=?2", [src.as_str(), sid.as_str()], |r| r.get(0)).optional()?;
    }
    if vid.is_none() {
        if let Some(v) = a.num("variant") {
            vid = c.query_row("SELECT id FROM msg_variants WHERE id=?1", [v], |r| r.get(0)).optional()?;
        }
    }
    if vid.is_none() {
        if let Some(g) = a.num("group") {
            vid = c
                .query_row(
                    "SELECT v.id FROM msg_variants v JOIN msg_groups g ON g.id = v.group_id
                     WHERE v.group_id=?1 AND v.para_count > 0
                     ORDER BY (v.id = g.preferred_variant) DESC, (v.superseded_by IS NULL) DESC, v.para_count DESC LIMIT 1",
                    [g],
                    |r| r.get(0),
                )
                .optional()?;
        }
    }
    let mut v = vid.ok_or_else(|| AppError::msg("mensagem não encontrada no banco do plugin"))?;
    for _ in 0..4 {
        match c.query_row("SELECT superseded_by FROM msg_variants WHERE id=?1", [v], |r| r.get::<_, Option<i64>>(0))? {
            Some(n) if n != v => v = n,
            _ => break,
        }
    }
    Ok(v)
}

/// A mensagem inteira em slides (parágrafo longo dividido), com o slide do § pedido.
fn paragraphs(a: &Args) -> Result<Value> {
    let (c, _) = plugin_db::open(a)?;
    let vid = resolve_variant(&c, a)?;
    let head = c.query_row(
        "SELECT v.source, v.source_id, v.translation, v.title, v.local, v.para_count, g.id, g.code, g.date_key, g.title, g.local
         FROM msg_variants v JOIN msg_groups g ON g.id = v.group_id WHERE v.id=?1",
        [vid],
        |r| {
            let vt: String = r.get(3)?;
            let gt: String = r.get(9)?;
            let vl: String = r.get(4)?;
            let gl: String = r.get(10)?;
            Ok(json!({
                "variant": vid, "source": r.get::<_, String>(0)?, "source_id": r.get::<_, String>(1)?, "translation": r.get::<_, String>(2)?,
                "para_count": r.get::<_, i64>(5)?, "group": r.get::<_, i64>(6)?, "code": r.get::<_, String>(7)?, "date_key": r.get::<_, String>(8)?,
                "title": if vt.trim().is_empty() { gt } else { vt },
                "local": if vl.trim().is_empty() { gl } else { vl },
            }))
        },
    )?;
    let paras = messages::paragraphs(&c, vid)?;
    if paras.is_empty() {
        return Err(AppError::msg("esta tradução não tem texto"));
    }
    let start = if let Some(seq) = a.num("seq") {
        paras.iter().position(|p| p.seq == seq)
    } else if let Some(num) = a.num("num") {
        paras.iter().position(|p| p.num == num).or_else(|| paras.iter().position(|p| p.num >= num))
    } else {
        None
    }
    .unwrap_or(0);
    let max = chars(a);
    let mut slides = vec![];
    let mut start_slide = 0;
    for (i, p) in paras.iter().enumerate() {
        if i == start {
            start_slide = slides.len();
        }
        let parts = chunk_text(&p.text, max);
        let n = parts.len();
        for (k, t) in parts.into_iter().enumerate() {
            slides.push(json!({ "text": t, "num": p.num, "seq": p.seq, "part": k + 1, "parts": n }));
        }
    }
    let start_slide = start_slide.min(slides.len().saturating_sub(1));
    let mut out = head;
    out["start_slide"] = json!(start_slide);
    out["start_num"] = json!(paras[start].num);
    out["start_seq"] = json!(paras[start].seq);
    out["slides"] = Value::Array(slides);
    Ok(out)
}

/// Primeiro parágrafo com este § (ou o seguinte) numa variante: (seq, num).
pub fn seq_for_num(c: &Connection, vid: i64, num: Option<i64>) -> Result<Option<(i64, i64)>> {
    let Some(n) = num else { return Ok(None) };
    Ok(c
        .query_row(
            "SELECT seq, num FROM msg_paragraphs WHERE variant_id=?1 AND num >= ?2 ORDER BY (num = ?2) DESC, seq LIMIT 1",
            params![vid, n],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}
