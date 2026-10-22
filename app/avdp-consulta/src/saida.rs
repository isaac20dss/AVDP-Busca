//! Resposta em pedaços. O Holyrics 2.30 entrega cortada a saída grande do `executeCmdAndWait`
//! (visto em 2026-10-18: o `JSON.parse` do módulo falhava numa pesquisa). Com `--max-out N`, a
//! resposta maior que N fica num arquivo temporário e sai só um cabeçalho
//! `{"ok":true,"chunked":true,"token":…,"size":…}`; o módulo pede os pedaços com
//! `chunk --token T --offset O --len L` (texto cru, sem quebra de linha) e confere o tamanho de cada um.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

fn dir() -> PathBuf {
    std::env::temp_dir().join("avdp-consulta")
}

fn valid_token(t: &str) -> bool {
    !t.is_empty() && t.len() <= 64 && t.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Guarda a resposta e devolve o token. Apaga as respostas com mais de 30 minutos.
pub fn save(text: &str) -> std::io::Result<String> {
    let d = dir();
    std::fs::create_dir_all(&d)?;
    if let Ok(rd) = std::fs::read_dir(&d) {
        let old = SystemTime::now() - Duration::from_secs(30 * 60);
        for e in rd.flatten() {
            if e.metadata().and_then(|m| m.modified()).is_ok_and(|t| t < old) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let token = format!("{:x}{:x}", std::process::id(), nanos);
    std::fs::write(d.join(format!("{token}.json")), text)?;
    Ok(token)
}

/// `chunk --token T --offset O --len L`: escreve o pedaço pedido (ASCII cru). Devolve o código de saída.
pub fn chunk(argv: &[String], out: &mut impl std::io::Write) -> i32 {
    let get = |k: &str| argv.iter().position(|a| a == k).and_then(|i| argv.get(i + 1)).cloned().unwrap_or_default();
    let token = get("--token");
    let (Ok(offset), Ok(len)) = (get("--offset").parse::<usize>(), get("--len").parse::<usize>()) else {
        let _ = write!(out, "!erro: --offset e --len");
        return 1;
    };
    if !valid_token(&token) {
        let _ = write!(out, "!erro: token");
        return 1;
    }
    let Ok(text) = std::fs::read(dir().join(format!("{token}.json"))) else {
        let _ = write!(out, "!erro: resposta expirada");
        return 1;
    };
    let start = offset.min(text.len());
    let end = offset.saturating_add(len).min(text.len());
    let _ = out.write_all(&text[start..end]);
    let _ = out.flush();
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_reads_pieces() {
        let text = format!("{{\"ok\":true,\"pad\":\"{}\"}}", "x".repeat(10_000));
        let token = save(&text).unwrap();
        let mut joined = Vec::new();
        let mut off = 0;
        while off < text.len() {
            let argv: Vec<String> = ["chunk", "--token", &token, "--offset", &off.to_string(), "--len", "3000"].iter().map(|s| s.to_string()).collect();
            let mut piece = Vec::new();
            assert_eq!(chunk(&argv, &mut piece), 0);
            assert_eq!(piece.len(), 3000.min(text.len() - off));
            joined.extend(piece);
            off += 3000;
        }
        assert_eq!(String::from_utf8(joined).unwrap(), text);
        let bad: Vec<String> = ["chunk", "--token", "../x", "--offset", "0", "--len", "1"].iter().map(|s| s.to_string()).collect();
        let mut piece = Vec::new();
        assert_eq!(chunk(&bad, &mut piece), 1);
    }
}
