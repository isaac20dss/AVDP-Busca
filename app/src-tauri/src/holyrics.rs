//! Ponte com o Holyrics pela API oficial (API Server do Holyrics, com token).
//! O Holyrics projeta com o texto da Bíblia licenciada dele.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(default)]
pub struct HolyricsConfig {
    pub host: String,
    pub port: u16,
    pub token: String,
}

impl HolyricsConfig {
    fn url(&self, action: &str) -> String {
        let host = if self.host.trim().is_empty() { "127.0.0.1" } else { self.host.trim() };
        let port = if self.port == 0 { 8091 } else { self.port };
        format!("http://{host}:{port}/api/{action}?token={}", self.token.trim())
    }
}

pub async fn call(cfg: &HolyricsConfig, action: &str, body: Value) -> Result<Value, AppError> {
    if cfg.token.trim().is_empty() {
        return Err(AppError::msg("Informe o token do API Server do Holyrics em Configurações."));
    }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(6)).build()?;
    let res = client
        .post(cfg.url(action))
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::msg(format!("Holyrics não respondeu ({e}). Ele está aberto com o API Server ligado?")))?;
    let v: Value = res.json().await?;
    if v.get("status").and_then(Value::as_str) == Some("error") {
        return Err(AppError::msg(format!("Holyrics: {}", error_text(v.get("error")))));
    }
    Ok(v)
}

/// Texto legível do erro do Holyrics: vem como texto ou como objeto (`message`, `key`,
/// `unauthorized_actions` + `request_status` quando falta permissão no token).
pub fn error_text(e: Option<&Value>) -> String {
    match e {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(o)) => {
            if let Some(a) = o.get("unauthorized_actions").and_then(Value::as_str) {
                let hint = match o.get("request_status").and_then(Value::as_str) {
                    Some("pending") => " (o Holyrics mostrou um pedido de liberação na tela dele)",
                    Some("denied") => " (o pedido de permissão foi negado no Holyrics)",
                    _ => " (libere em API Server → gerenciar permissões, no Holyrics)",
                };
                return format!("o token não tem permissão para {a}{hint}");
            }
            o.get("message")
                .and_then(Value::as_str)
                .or_else(|| o.get("key").and_then(Value::as_str))
                .map(str::to_string)
                .unwrap_or_else(|| Value::Object(o.clone()).to_string())
        }
        _ => "erro desconhecido".into(),
    }
}

pub async fn show_verse(cfg: &HolyricsConfig, ids: Vec<String>, version: Option<String>) -> Result<(), AppError> {
    let mut body = json!({ "ids": ids });
    if let Some(v) = version.filter(|v| !v.is_empty()) {
        body["version"] = json!(v);
    }
    call(cfg, "ShowVerse", body).await.map(|_| ())
}

pub async fn show_slides(cfg: &HolyricsConfig, slides: Vec<String>) -> Result<(), AppError> {
    let slides: Vec<Value> = slides.into_iter().map(|t| json!({ "text": t })).collect();
    call(cfg, "ShowQuickPresentation", json!({ "slides": slides })).await.map(|_| ())
}

pub async fn versions(cfg: &HolyricsConfig) -> Result<Value, AppError> {
    Ok(call(cfg, "GetBibleVersionsV2", json!({})).await?.get("data").cloned().unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readable_errors() {
        assert_eq!(error_text(Some(&json!("falhou"))), "falhou");
        assert_eq!(error_text(Some(&json!({ "code": 9, "key": "device_disconnected", "message": "Device disconnected" }))), "Device disconnected");
        let e = error_text(Some(&json!({ "unauthorized_actions": "AddToPlaylist", "request_status": "pending" })));
        assert!(e.contains("AddToPlaylist") && e.contains("pedido de liberação"), "{e}");
        assert_eq!(error_text(None), "erro desconhecido");
    }
}
