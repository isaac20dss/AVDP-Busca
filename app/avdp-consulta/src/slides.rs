//! Cortes de slide iguais aos do telão do AVDP (`app/src/lib/slides.ts`): parágrafo longo dividido
//! no fim de frases, letra na ordem dos parágrafos, texto em blocos.

use once_cell::sync::Lazy;
use regex::Regex;

/// Tamanho como no JavaScript (unidades UTF-16; igual ao nº de caracteres no português).
fn len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Referência bíblica não se parte entre slides ("Mat. 16:17", "Is. 54:13", "I Cor. 2:6-16", "João 6:45"):
/// o ponto da abreviação vira U+E000 (não fecha frase) e os espaços viram U+00A0 (não separam palavra).
/// Mesma regra do `glueRefs` do app.
pub fn glue_refs(t: &str) -> String {
    static ABBR: Lazy<Regex> = Lazy::new(|| Regex::new(r"(^|[^\p{L}\d])(\p{Lu}\p{Ll}{0,5})\.( ?)(\d{1,3}:\d)").unwrap());
    static BOOK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\p{L}) (\d{1,3}:\d)").unwrap());
    static ORD: Lazy<Regex> = Lazy::new(|| Regex::new(r"(^|[^\p{L}\d])(I{1,3}|[1-3]) (\p{Lu}\p{Ll}{1,12}\x{E000}?\x{A0}?\d)").unwrap());
    let t = ABBR.replace_all(t, |c: &regex::Captures| {
        format!("{}{}\u{E000}{}{}", &c[1], &c[2], if c[3].is_empty() { "" } else { "\u{A0}" }, &c[4])
    });
    let t = BOOK.replace_all(&t, "${1}\u{A0}${2}");
    ORD.replace_all(&t, "${1}${2}\u{A0}${3}").into_owned()
}

/// Quebra um texto longo em pedaços de até `max` caracteres, no fim de frases, sem partir
/// referência bíblica (`chunkText`).
pub fn chunk_text(text: &str, max: usize) -> Vec<String> {
    let t = crate::text::squash_spaces(text);
    if t.is_empty() {
        return vec![];
    }
    if len(&t) <= max {
        return vec![t];
    }
    chunk_glued(&glue_refs(&t), max).into_iter().map(|s| s.replace('\u{E000}', ".").replace('\u{A0}', " ")).collect()
}

fn chunk_glued(t: &str, max: usize) -> Vec<String> {
    static SENTENCE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"[^.!?…]+[.!?…]+["”’)]*\s*|[^.!?…]+$"#).unwrap());
    let sentences: Vec<&str> = {
        let v: Vec<&str> = SENTENCE.find_iter(t).map(|m| m.as_str()).collect();
        if v.is_empty() { vec![t] } else { v }
    };
    let mut out: Vec<String> = vec![];
    let mut cur = String::new();
    for s in sentences {
        if len(&cur) + len(s) > max && !cur.is_empty() {
            out.push(cur.trim().to_string());
            cur.clear();
        }
        if len(s) > max {
            // frase gigante: corta por palavras
            for w in s.split(' ') {
                if len(&cur) + 1 + len(w) > max && !cur.is_empty() {
                    out.push(cur.trim().to_string());
                    cur.clear();
                }
                if !cur.is_empty() {
                    cur.push(' ');
                }
                cur.push_str(w);
            }
        } else {
            cur.push_str(s);
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    // evita último pedaço minúsculo
    if out.len() > 1 && len(out.last().unwrap()) * 4 < max {
        let last = out.pop().unwrap();
        let prev = out.last_mut().unwrap();
        prev.push(' ');
        prev.push_str(&last);
    }
    out
}

/// Parágrafos da letra (separados por linha em branco), sem a linha de etiqueta ("Refrão:").
fn lyric_paragraphs(lyrics: &str) -> Vec<Vec<String>> {
    static LABEL: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)^\s*[\[(]?\s*(refr[aã]o|coro|chorus|ponte|bridge|pr[eé]-?refr[aã]o|final|intro|verso|estrofe|parte)\b[^\n\]):]*[\])]?:?\s*$").unwrap()
    });
    static BLANK: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n\s*\n+").unwrap());
    let norm = lyrics.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = vec![];
    for b in BLANK.split(&norm) {
        let mut lines: Vec<String> = b.split('\n').map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        if lines.is_empty() {
            continue;
        }
        if lines.len() > 1 && LABEL.is_match(&lines[0]) {
            lines.remove(0);
        }
        out.push(lines);
    }
    out
}

/// "1,2,3,2" → índices válidos; vazio = todos na ordem (`parseOrder`).
fn parse_order(order: &str, count: usize) -> Vec<usize> {
    let nums: Vec<usize> = order
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .filter_map(|s| s.parse::<i64>().ok())
        .filter(|&n| n >= 1 && (n as usize) <= count)
        .map(|n| n as usize - 1)
        .collect();
    if nums.is_empty() { (0..count).collect() } else { nums }
}

/// Letra na ordem dos slides (refrão repetido), um slide por parágrafo, separados por linha em branco.
pub fn song_text(lyrics: &str, order: &str) -> String {
    let paras = lyric_paragraphs(lyrics);
    parse_order(order, paras.len()).into_iter().map(|i| paras[i].join("\n")).collect::<Vec<_>>().join("\n\n")
}

/// Texto avulso em blocos; bloco maior que `max` é cortado como as mensagens (`textSlides`).
pub fn text_slides(body: &str, max: usize) -> Vec<String> {
    static BLANK: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n\s*\n+").unwrap());
    let norm = body.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = vec![];
    for b in BLANK.split(&norm).map(str::trim).filter(|b| !b.is_empty()) {
        if len(b) <= max {
            out.push(b.to_string());
        } else {
            out.extend(chunk_text(b, max));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_is_one_slide() {
        assert_eq!(chunk_text("  Uma  frase\ncurta. ", 420), vec!["Uma frase curta."]);
        assert!(chunk_text("   ", 420).is_empty());
    }

    #[test]
    fn same_cut_as_the_app() {
        // saídas do chunkText do app (slides.ts) rodado no Node com estes mesmos textos (2026-10-18)
        let w7 = "palavra palavra palavra palavra palavra palavra palavra";
        let cases: Vec<(String, usize, Vec<&str>)> = vec![
            (
                "Primeira frase aqui. Segunda frase um pouco maior que a primeira! Terceira? Quarta frase final.".into(),
                40,
                vec!["Primeira frase aqui.", "Segunda frase um pouco maior que a", "primeira! Terceira? Quarta frase final."],
            ),
            ("palavra ".repeat(30) + "fim.", 60, vec![w7, w7, w7, w7, "palavra palavra fim."]),
            (
                "E Ele disse: “Eu sou a luz do mundo.” Quem me segue não andará em trevas… Mas terá a luz da vida. Amém!".into(),
                50,
                vec!["E Ele disse: “Eu sou a luz do mundo.”", "Quem me segue não andará em trevas…", "Mas terá a luz da vida. Amém!"],
            ),
            (
                "...Começa com reticências. E segue, sem parar, com uma frase bem comprida que passa do limite de caracteres permitido aqui".into(),
                50,
                vec!["Começa com reticências.", "E segue, sem parar, com uma frase bem comprida que", "passa do limite de caracteres permitido aqui"],
            ),
        ];
        for (text, max, want) in cases {
            assert_eq!(chunk_text(&text, max), want, "{text}");
        }
    }

    #[test]
    fn bible_reference_stays_in_one_slide() {
        // saídas do chunkText do app (slides.ts) no Node com o mesmo texto (2026-10-28)
        let t = "Volte porém a Is. 54:13 de onde isto foi tirado e assim se lê: \"E todos os teus filhos serão discípulos do Senhor.\" Os TODOS de Deus são os FILHOS de Deus. Veja Mat. 16:17 e I Cor. 2:6-16 também, e Mat.16:17.";
        assert_eq!(
            chunk_text(t, 60),
            vec![
                "Volte porém a Is. 54:13 de onde isto foi tirado e assim se",
                "lê: \"E todos os teus filhos serão discípulos do Senhor.\"",
                "Os TODOS de Deus são os FILHOS de Deus.",
                "Veja Mat. 16:17 e I Cor. 2:6-16 também, e Mat.16:17.",
            ]
        );
        assert_eq!(chunk_text("a b c d e f g h i j em João 6:45 e mais", 22), vec!["a b c d e f g h i j em", "João 6:45 e mais"]);
    }

    #[test]
    fn song_order_and_labels() {
        // "Estrofe 1" sozinho na linha também é etiqueta (mesma regra do app)
        let lyrics = "Primeira linha\nlinha dois\n\nRefrão:\nSanto, santo\n\nEstrofe 2\nÚltima";
        assert_eq!(song_text(lyrics, ""), "Primeira linha\nlinha dois\n\nSanto, santo\n\nÚltima");
        assert_eq!(song_text(lyrics, "1,2,3,2"), "Primeira linha\nlinha dois\n\nSanto, santo\n\nÚltima\n\nSanto, santo");
        assert_eq!(song_text(lyrics, "9, x"), song_text(lyrics, ""));
    }

    #[test]
    fn text_blocks() {
        let body = "Título\n\nBloco curto\ncom duas linhas\r\n\r\n\r\nOutro.";
        assert_eq!(text_slides(body, 420), vec!["Título", "Bloco curto\ncom duas linhas", "Outro."]);
    }
}
