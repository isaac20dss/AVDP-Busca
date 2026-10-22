//! Normalização de texto: minúsculas, sem acentos, palavras.

use unicode_normalization::UnicodeNormalization;

/// Minúsculas e sem acentos ("Ação" -> "acao").
pub fn fold(s: &str) -> String {
    s.nfd()
        .filter(|c| !('\u{0300}'..='\u{036f}').contains(c))
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Palavras dobradas (sem acento, minúsculas), separando por tudo que não é letra/número.
pub fn words(s: &str) -> Vec<String> {
    fold(s)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_string())
        .collect()
}

/// Junta espaços repetidos e apara.
pub fn squash_spaces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !space && !out.is_empty() {
                out.push(' ');
            }
            space = true;
        } else {
            out.push(c);
            space = false;
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_removes_accents() {
        assert_eq!(fold("Ação Êxodo JOÃO"), "acao exodo joao");
        assert_eq!(fold("Cânticos"), "canticos");
    }

    #[test]
    fn words_split() {
        assert_eq!(words("Jo 3:16, \"Deus\"-amou"), vec!["jo", "3", "16", "deus", "amou"]);
    }

    #[test]
    fn squash() {
        assert_eq!(squash_spaces("  a \n\t b  "), "a b");
    }
}
