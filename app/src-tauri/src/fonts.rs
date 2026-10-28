//! Fontes de letra de fora do app: as instaladas no computador (pelo nome da família) e as
//! importadas de arquivo (.ttf/.otf/.woff/.woff2), copiadas para `{pasta de dados}/fontes`.

use crate::error::AppError;
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

type Res<T> = Result<T, AppError>;

const EXTS: [&str; 4] = ["ttf", "otf", "woff", "woff2"];

#[derive(Serialize, Clone)]
pub struct CustomFont {
    pub family: String,
    pub weight: u16,
    pub italic: bool,
    pub file: String,
}

fn is_font(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Família, peso e itálico pela tabela `name`/`OS/2` (TTF/OTF). WOFF não é lido: família = nome do arquivo.
fn describe(path: &Path) -> Option<CustomFont> {
    let file = path.file_name()?.to_string_lossy().into_owned();
    let stem = path.file_stem()?.to_string_lossy().into_owned();
    let data = std::fs::read(path).ok()?;
    let parsed = ttf_parser::Face::parse(&data, 0).ok().map(|face| {
        let name = |id: u16| {
            face.names().into_iter().filter(|n| n.name_id == id && n.is_unicode()).find_map(|n| n.to_string())
        };
        // 16 = família tipográfica ("Montserrat"), 1 = família antiga ("Montserrat Black")
        let family = name(ttf_parser::name_id::TYPOGRAPHIC_FAMILY).or_else(|| name(ttf_parser::name_id::FAMILY));
        (family, face.weight().to_number(), face.is_italic())
    });
    let (family, weight, italic) = parsed.unwrap_or((None, 400, false));
    Some(CustomFont { family: family.unwrap_or(stem), weight, italic, file })
}

fn system_dirs() -> Vec<PathBuf> {
    let mut v = vec![];
    if cfg!(windows) {
        v.push(PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into())).join("Fonts"));
        if let Ok(l) = std::env::var("LOCALAPPDATA") {
            v.push(PathBuf::from(l).join(r"Microsoft\Windows\Fonts"));
        }
    } else {
        v.push("/Library/Fonts".into());
        v.push("/System/Library/Fonts".into());
        if let Ok(h) = std::env::var("HOME") {
            v.push(PathBuf::from(h).join("Library/Fonts"));
        }
    }
    v
}

/// Famílias instaladas no computador (lidas uma vez por execução).
pub fn system_families() -> Vec<String> {
    static CACHE: OnceLock<Vec<String>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let mut set = BTreeSet::new();
            for dir in system_dirs() {
                let Ok(rd) = std::fs::read_dir(&dir) else { continue };
                for e in rd.flatten() {
                    let p = e.path();
                    let ttc = p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("ttc"));
                    // arquivo enorme (fontes asiáticas de 20+ MB) deixaria a lista lenta
                    let small = e.metadata().is_ok_and(|m| m.len() < 40 << 20);
                    if (is_font(&p) || ttc)
                        && small
                        && let Some(f) = describe(&p)
                        && !f.family.starts_with('.')
                    {
                        set.insert(f.family);
                    }
                }
            }
            set.into_iter().collect()
        })
        .clone()
}

/// Fontes importadas para o app.
pub fn custom(data_dir: &Path) -> Vec<CustomFont> {
    let Ok(rd) = std::fs::read_dir(data_dir.join("fontes")) else { return vec![] };
    let mut v: Vec<CustomFont> = rd.flatten().map(|e| e.path()).filter(|p| is_font(p)).filter_map(|p| describe(&p)).collect();
    v.sort_by(|a, b| (&a.family, a.weight, a.italic).cmp(&(&b.family, b.weight, b.italic)));
    v
}

/// Copia um arquivo de fonte para a pasta do app.
pub fn import(data_dir: &Path, src: &Path) -> Res<CustomFont> {
    if !is_font(src) {
        return Err(AppError::msg("arquivo de fonte inválido (use .ttf, .otf, .woff ou .woff2)"));
    }
    let dir = data_dir.join("fontes");
    std::fs::create_dir_all(&dir)?;
    let dst = dir.join(src.file_name().ok_or_else(|| AppError::msg("arquivo inválido"))?);
    if src != dst {
        std::fs::copy(src, &dst)?;
    }
    describe(&dst).ok_or_else(|| AppError::msg("não foi possível ler a fonte"))
}

/// Caminho de uma fonte importada pelo nome do arquivo (sem sair da pasta `fontes`).
pub fn file_path(data_dir: &Path, file: &str) -> Res<PathBuf> {
    let name = Path::new(file).file_name().ok_or_else(|| AppError::msg("arquivo inválido"))?;
    Ok(data_dir.join("fontes").join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_reads_family_and_weight() {
        let dir = std::env::temp_dir().join(format!("avdp-fontes-{}", std::process::id()));
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fontes/Montserrat-700.ttf");
        let f = import(&dir, &src).unwrap();
        assert_eq!((f.family.as_str(), f.weight, f.italic), ("Montserrat", 700, false));
        assert_eq!(custom(&dir).len(), 1);
        assert!(file_path(&dir, "../../x.ttf").unwrap().starts_with(dir.join("fontes")));
        assert!(import(&dir, Path::new("leia-me.txt")).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn system_list_has_fonts() {
        // Windows e Mac sempre têm Arial
        assert!(system_families().iter().any(|f| f == "Arial"));
    }
}
