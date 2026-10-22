//! Linha de comando: `comando --chave valor --opção`. Valor começado por `x:` vem em hexadecimal
//! (bytes UTF-8), o jeito seguro de passar aspas, acentos e espaços pelo `executeCmdAndWait`.

use crate::db::Result;
use crate::error::AppError;
use std::collections::{HashMap, HashSet};

pub struct Args {
    pub cmd: String,
    vals: HashMap<String, String>,
    flags: HashSet<String>,
}

impl Args {
    pub fn parse(argv: &[String]) -> Result<Self> {
        let mut it = argv.iter().peekable();
        let cmd = match it.next() {
            Some(c) if !c.starts_with("--") => c.to_lowercase(),
            _ => "help".to_string(),
        };
        let mut vals = HashMap::new();
        let mut flags = HashSet::new();
        while let Some(a) = it.next() {
            let Some(key) = a.strip_prefix("--") else {
                return Err(AppError::msg(format!("argumento solto: {a}")));
            };
            let key = key.to_lowercase();
            match it.peek() {
                Some(v) if !v.starts_with("--") => {
                    let v = it.next().unwrap();
                    vals.insert(key, decode(v)?);
                }
                _ => {
                    flags.insert(key);
                }
            }
        }
        Ok(Self { cmd, vals, flags })
    }

    /// Valor não vazio.
    pub fn get(&self, key: &str) -> Option<String> {
        self.vals.get(key).filter(|v| !v.trim().is_empty()).cloned()
    }

    pub fn num(&self, key: &str) -> Option<i64> {
        self.get(key).and_then(|v| v.trim().parse().ok())
    }

    /// `--chave` sozinho, ou `--chave 1|true|sim`.
    pub fn flag(&self, key: &str) -> bool {
        self.flags.contains(key) || self.vals.get(key).is_some_and(|v| matches!(v.trim().to_lowercase().as_str(), "1" | "true" | "sim" | "yes"))
    }
}

/// `x:` + hexadecimal dos bytes UTF-8 → texto; qualquer outro valor fica como está.
pub fn decode(v: &str) -> Result<String> {
    let Some(hex) = v.strip_prefix("x:") else { return Ok(v.to_string()) };
    let bad = || AppError::msg("argumento em hexadecimal mal formado");
    if hex.len() % 2 != 0 {
        return Err(bad());
    }
    let bytes = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|_| bad()))
        .collect::<Result<Vec<u8>>>()?;
    String::from_utf8(bytes).map_err(|_| bad())
}

/// JSON só com ASCII: todo caractere fora do ASCII vira `\uXXXX` (pares substitutos acima do BMP).
/// Fora das strings o JSON já é ASCII, então trocar em todo o texto é seguro.
pub fn ascii_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + s.len() / 8);
    let mut buf = [0u16; 2];
    for c in s.chars() {
        if c.is_ascii() {
            out.push(c);
        } else {
            for u in c.encode_utf16(&mut buf) {
                out.push_str(&format!("\\u{u:04x}"));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> String {
        format!("x:{}", s.bytes().map(|b| format!("{b:02x}")).collect::<String>())
    }

    #[test]
    fn parse_values_flags_and_hex() {
        let argv: Vec<String> = ["search", "--q", &hex("\"sétimo selo\" -anjo"), "--whole-word", "--limit", "20", "--variants", "1"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let a = Args::parse(&argv).unwrap();
        assert_eq!(a.cmd, "search");
        assert_eq!(a.get("q").unwrap(), "\"sétimo selo\" -anjo");
        assert!(a.flag("whole-word"));
        assert!(a.flag("variants"));
        assert!(!a.flag("fuzzy"));
        assert_eq!(a.num("limit"), Some(20));
    }

    #[test]
    fn negative_word_is_a_value() {
        let argv: Vec<String> = ["search", "--q", "-anjo"].iter().map(|s| s.to_string()).collect();
        assert_eq!(Args::parse(&argv).unwrap().get("q").unwrap(), "-anjo");
    }

    #[test]
    fn bad_hex_is_an_error() {
        assert!(decode("x:4").is_err());
        assert!(decode("x:zz").is_err());
        assert!(decode("x:c3").is_err()); // UTF-8 incompleto
    }

    #[test]
    fn ascii_output_round_trips() {
        let v = serde_json::json!({ "t": "Ação — §12 “aspas” 𝄞", "n": 1 });
        let s = ascii_json(&serde_json::to_string(&v).unwrap());
        assert!(s.is_ascii());
        let back: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(back, v);
    }
}
