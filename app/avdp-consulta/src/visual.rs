//! `visual`: o visual das letras do AVDP Busca para o Holyrics (botão "Aplicar visual do AVDP" do módulo).
//! Lê no `avdp.db` o tema das letras e o papel de parede, copia as imagens para a aba Imagens da
//! biblioteca do Holyrics (pasta `AVDP`) e devolve o tema no formato `Theme` do jslib, para o módulo
//! criar com `h.popupCreateTheme` e pôr o papel de parede com `SetWallpaperSettings`.

use crate::args::Args;
use crate::db::Result;
use crate::error::AppError;
use crate::plugin_db::open_read_only;
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Pasta das imagens dentro da aba Imagens do Holyrics.
const SUBDIR: &str = "AVDP";

pub fn run(a: &Args) -> Result<Value> {
    let data_dir = match a.get("avdp-dir") {
        Some(d) => PathBuf::from(d.trim()),
        None => std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("br.avdp.busca")).ok_or_else(|| AppError::msg("sem %APPDATA%"))?,
    };
    let db = data_dir.join("avdp.db");
    if !db.is_file() {
        return Err(AppError::msg(format!("banco do AVDP Busca não encontrado: {}", db.display())));
    }
    // o programa fica em files\media\file; as imagens vão para files\media\image\AVDP
    let lib = match a.get("lib") {
        Some(d) => PathBuf::from(d.trim()),
        None => std::env::current_exe()?.parent().and_then(Path::parent).map(|m| m.join("image")).ok_or_else(|| AppError::msg("não achei a biblioteca do Holyrics"))?,
    };
    let c = open_read_only(&db)?;
    let ui: Value = c
        .query_row("SELECT value FROM settings WHERE key='ui'", [], |r| r.get::<_, String>(0))
        .optional()?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    // tema das letras (sem escolha, o primeiro, como no AVDP)
    let id = ui["themeByKind"]["song"].as_i64();
    let row: Option<(String, String)> = match id {
        Some(id) => c.query_row("SELECT name, data FROM themes WHERE id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?,
        None => None,
    };
    let (name, data) = match row {
        Some(r) => r,
        None => c.query_row("SELECT name, data FROM themes ORDER BY id LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?)))?,
    };
    let t: Value = serde_json::from_str(&data).map_err(|e| AppError::msg(format!("tema do AVDP ilegível: {e}")))?;
    let dest = lib.join(SUBDIR);
    let bg_file = match t["bg"]["kind"].as_str() {
        Some("image") => t["bg"]["image"].as_str().map(|p| copy_image(p, &data_dir, &dest)).transpose()?,
        _ => None,
    };
    let wallpaper = ui["wallpaperImage"].as_str().filter(|s| !s.trim().is_empty()).map(|p| copy_image(p, &data_dir, &dest)).transpose()?;
    Ok(json!({
        "theme": holyrics_theme(&format!("AVDP - {name}"), &t, bg_file.as_deref()),
        "wallpaper": wallpaper,
        "folder": dest.display().to_string(),
    }))
}

/// Copia a imagem (o caminho guardado, ou o mesmo nome em `fundos`, se o banco veio de outro PC) e
/// devolve o nome como a aba Imagens do Holyrics o conhece: `AVDP/arquivo.png`.
fn copy_image(stored: &str, data_dir: &Path, dest: &Path) -> Result<String> {
    let stored = PathBuf::from(stored);
    let file = stored.file_name().ok_or_else(|| AppError::msg(format!("imagem sem nome: {}", stored.display())))?.to_owned();
    let src = if stored.is_file() { stored.clone() } else { data_dir.join("fundos").join(&file) };
    if !src.is_file() {
        return Err(AppError::msg(format!("imagem do AVDP não encontrada: {}", stored.display())));
    }
    std::fs::create_dir_all(dest)?;
    std::fs::copy(&src, dest.join(&file))?;
    Ok(format!("{SUBDIR}/{}", file.to_string_lossy()))
}

fn hex(c: &Value, def: &str) -> String {
    c.as_str().map(|s| s.trim_start_matches('#').to_uppercase()).filter(|s| s.len() == 6).unwrap_or_else(|| def.into())
}

/// Tema do AVDP (`lib/theme.ts`) → `Theme` do Holyrics. Os dois medem a letra e as margens em % da
/// altura do slide; a margem do lado no AVDP é 1,2 × a de cima, em % da altura (16:9 → × 9/16 na largura).
fn holyrics_theme(name: &str, t: &Value, bg_file: Option<&str>) -> Value {
    let pad = t["padding"].as_f64().unwrap_or(6.0);
    let side = (pad * 1.2 * 9.0 / 16.0 * 10.0).round() / 10.0;
    let outline = t["outline"].as_f64().unwrap_or(0.0);
    let background = match (bg_file, t["bg"]["kind"].as_str()) {
        (Some(f), _) => json!({ "type": "image_file", "id": f, "adjust_type": "fill", "opacity": 100 - t["bg"]["dim"].as_i64().unwrap_or(0) }),
        // gradiente: a primeira cor dele
        (None, Some("gradient")) => {
            let g = t["bg"]["gradient"].as_str().unwrap_or("");
            let first = g.find('#').map(|i| g[i..].chars().take(7).collect::<String>());
            json!({ "type": "color", "id": hex(&json!(first), "000000") })
        }
        _ => json!({ "type": "color", "id": hex(&t["bg"]["color"], "000000") }),
    };
    json!({
        "name": name,
        "background": background,
        "base_color": "000000",
        "font": {
            "name": t["font"].as_str().unwrap_or("Montserrat"),
            "bold": t["bold"].as_bool().unwrap_or(true),
            "italic": t["italic"].as_bool().unwrap_or(false),
            "size": t["size"].as_f64().unwrap_or(7.0).clamp(1.0, 50.0),
            "color": hex(&t["color"], "FFFFFF"),
            "line_spacing": ((t["lineHeight"].as_f64().unwrap_or(1.3) - 1.0) * 100.0).round() / 100.0,
        },
        "align": {
            "horizontal": t["align"].as_str().unwrap_or("center"),
            "vertical": t["valign"].as_str().unwrap_or("middle"),
            "margin": { "top": pad, "right": side, "bottom": pad, "left": side },
        },
        "effect": {
            "outline_color": hex(&t["outlineColor"], "000000"),
            "outline_weight": outline * 10.0,
            "shadow_color": "000000",
            "shadow_x_weight": 0,
            "shadow_y_weight": if t["shadow"].as_bool().unwrap_or(false) { 8 } else { 0 },
            "blur": true,
        },
        "settings": { "uppercase": t["uppercase"].as_bool().unwrap_or(false) },
    })
}
