//! avdp-consulta — consulta as Mensagens do AVDP Busca para o módulo do Holyrics.
//!
//! O módulo (`avdp-mensagens.js`, colado na janela Módulos do Holyrics) chama este programa por
//! `module.executeCmdAndWait('avdp-consulta.exe', [...])`. A resposta é sempre um JSON numa linha,
//! só com caracteres ASCII (acentos em `\uXXXX`), para não depender da codificação do console.
//! Texto livre nos argumentos pode vir em hexadecimal (`x:` + bytes UTF-8), porque aspas e acentos
//! na linha de comando do Windows se perdem conforme quem chama.
//!
//! Comandos (todos aceitam `--db <arquivo>`; sem ele, `C:\AVDP Holyrics\avdp-mensagens.db`):
//!   info                                   banco em uso e contagens
//!   search --q <texto> [--mode all|any|exact|near] [--near N] [--from AAAA] [--to AAAA]
//!          [--whole-word] [--variants] [--fuzzy] [--by-message] [--limit N] [--sort relevance|date|title|local]
//!   group --code 65-1127B | --filter <título> | --id N
//!   paragraphs (--src <fonte> --src-id <id> | --variant N | --group N) [--num N | --seq N] [--chars N]
//!   filas [--dir <pasta>]                   filas do AVDP (.avdpfila) achadas no PC
//!   fila --file <arquivo.avdpfila> [--chars N]   itens da fila prontos para a lista do Holyrics
//!   make-db --from <avdp.db> [--to <arquivo>]    gera o banco só de mensagens do plugin

#![allow(dead_code)]

// código do próprio AVDP Busca (mesma busca, mesmos grupos, mesmo esquema do banco)
#[path = "../../src-tauri/src/db.rs"]
mod db;
mod error;
#[path = "../../src-tauri/src/messages.rs"]
mod messages;
#[path = "../../src-tauri/src/search.rs"]
mod search;
#[path = "../../src-tauri/src/text.rs"]
mod text;
#[path = "../../src-tauri/src/themes.rs"]
mod themes;

mod args;
mod commands;
mod fila;
mod plugin_db;
mod saida;
mod slides;
#[cfg(test)]
mod tests;

use std::io::Write;

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if argv.first().is_some_and(|c| c == "chunk") {
        std::process::exit(saida::chunk(&argv, &mut std::io::stdout().lock()));
    }
    let started = std::time::Instant::now();
    let (code, mut out) = match args::Args::parse(&argv).and_then(|a| commands::run(&a)) {
        Ok(v) => (0, v),
        Err(e) => (1, serde_json::json!({ "ok": false, "error": e.to_string() })),
    };
    if let Some(o) = out.as_object_mut() {
        o.entry("ok").or_insert(serde_json::Value::Bool(true));
        o.insert("ms".into(), (started.elapsed().as_millis() as u64).into());
    }
    let mut stdout = std::io::stdout().lock();
    // `--texto`: resumo em português para as janelas dos scripts .cmd (o módulo usa o JSON)
    if argv.iter().any(|a| a == "--texto") {
        let _ = writeln!(stdout, "{}", human(&out));
        let _ = stdout.flush();
        std::process::exit(code);
    }
    let pretty = argv.iter().any(|a| a == "--pretty");
    let text = if pretty { serde_json::to_string_pretty(&out) } else { serde_json::to_string(&out) }.unwrap_or_else(|_| "{\"ok\":false}".into());
    let mut text = args::ascii_json(&text);
    // resposta maior que `--max-out`: vai em pedaços (saida.rs)
    let max_out = argv.iter().position(|a| a == "--max-out").and_then(|i| argv.get(i + 1)).and_then(|v| v.parse::<usize>().ok());
    if let Some(max) = max_out.filter(|&m| text.len() > m) {
        text = match saida::save(&text) {
            Ok(token) => format!("{{\"ok\":true,\"chunked\":true,\"token\":\"{token}\",\"size\":{}}}", text.len()),
            Err(e) => args::ascii_json(&serde_json::json!({ "ok": false, "error": format!("resposta grande ({} > {max}) e a pasta temporária falhou: {e}", text.len()) }).to_string()),
        };
    }
    let _ = stdout.write_all(text.as_bytes());
    let _ = stdout.write_all(b"\n");
    let _ = stdout.flush();
    std::process::exit(code);
}

fn human(v: &serde_json::Value) -> String {
    if v["ok"] == false {
        return format!("ERRO: {}", v["error"].as_str().unwrap_or("desconhecido"));
    }
    let n = |k: &str| v[k].as_i64().unwrap_or(0);
    if v.get("size_mb").is_some() {
        return format!(
            "OK: banco do plugin gerado em {} ({} MB): {} mensagens, {} traduções com texto, {} parágrafos.",
            v["db"].as_str().unwrap_or(""),
            v["size_mb"],
            n("groups"),
            n("variants_with_text"),
            n("paragraphs")
        );
    }
    if v.get("with_text").is_some() {
        return format!(
            "OK: avdp-consulta {} lendo {}: {} mensagens com texto ({} datas), {} parágrafos.",
            v["version"].as_str().unwrap_or(""),
            v["db"].as_str().unwrap_or(""),
            n("with_text"),
            n("groups"),
            n("paragraphs")
        );
    }
    "OK".into()
}
