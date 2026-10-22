//! Erro único devolvido ao front como texto.

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("banco de dados: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("arquivo: {0}")]
    Io(#[from] std::io::Error),
    #[error("rede: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("zip: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Msg(e.to_string())
    }
}
