//! MessageHub (messagehub.info), mensagens em "Português-B" (a tradução Crentes da Bíblia do Brasil).
//! O site só tem PDF: a lista vem das páginas do site, o PDF de cada mensagem é baixado aqui e o texto
//! é tirado no front (pdf.js, o mesmo da importação de arquivos) e volta para virar parágrafos.

use crate::db::Result;
use crate::messages::{self, NewVariant};
use crate::text::{fold, squash_spaces};
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

pub const HUB: &str = "https://www.messagehub.info";
/// Idioma "Português-B" no site.
pub const LANG_ID: u32 = 62;
pub const LANG: &str = "ptb";
/// Nome da tradução gravado nas mensagens do site.
pub const TRANSLATION: &str = "Crentes da Bíblia do Brasil";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct HubItem {
    /// Id da tradução no site (`selectTranslation(this, 5216, '62')`).
    pub tm_id: i64,
    pub code: String,
    pub title: String,
    pub title_en: String,
    pub local: String,
    /// "Atualizada em" (AAAA-MM-DD): muda quando o site revisa a tradução.
    pub updated: String,
}

/// Linhas da tabela de mensagens de uma página da lista.
pub fn parse_list(html: &str) -> Vec<HubItem> {
    static ROW: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
            r#"(?s)selectTranslation\(this,\s*(\d+),\s*'\d+'\)">\s*<td[^>]*>([^<]*)</td>\s*<td[^>]*>\s*<div class="foreignTitle">(.*?)</div>\s*(?:<div class="englishTitle">(.*?)</div>)?\s*</td>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>"#,
        )
        .unwrap()
    });
    let clean = |s: &str| squash_spaces(&messages::decode_entities(s));
    ROW.captures_iter(html)
        .filter_map(|c| {
            Some(HubItem {
                tm_id: c[1].parse().ok()?,
                code: clean(&c[2]),
                title: clean(&c[3]),
                title_en: c.get(4).map(|m| clean(m.as_str()).trim_matches(['(', ')']).to_string()).unwrap_or_default(),
                local: clean(&c[5]),
                updated: clean(&c[6]),
            })
        })
        .collect()
}

/// Código do arquivo para baixar: o PDF "Full Sheet" (A4; senão carta; senão o primeiro).
pub fn parse_artifacts(html: &str) -> Option<String> {
    static ART: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?s)downloadMessage\('([0-9a-fA-F]+)'\).*?captionCell">\s*([^<]*)"#).unwrap());
    let all: Vec<(String, String)> = ART.captures_iter(html).map(|c| (c[1].to_string(), fold(&c[2]))).collect();
    all.iter()
        .find(|(_, cap)| cap.contains("a4") && cap.contains("full"))
        .or_else(|| all.iter().find(|(_, cap)| cap.contains("full")))
        .or_else(|| all.first())
        .map(|(e, _)| e.clone())
}

/// Texto do PDF -> texto que o `parse_message` entende: tira o cabeçalho de página ("Título12"),
/// o rodapé final ("Sermões por… www.messagehub.info") e separa o número colado no parágrafo ("1Muito").
pub fn clean_text(text: &str, title: &str) -> String {
    static GLUED: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(\d{1,4})([\p{L}“\x22'(\[¿¡…—–])").unwrap());
    let head = fold(title);
    let head: String = head.chars().filter(|c| c.is_alphanumeric()).collect();
    let mut lines: Vec<String> = text.lines().map(|l| l.trim_end().to_string()).collect();
    // rodapé da última página
    if let Some(i) = lines.iter().rposition(|l| fold(l).trim() == "sermoes por") {
        if lines.len() - i <= 12 {
            lines.truncate(i);
        }
    }
    let mut out = String::with_capacity(text.len());
    for (i, l) in lines.iter().enumerate() {
        let core: String = fold(l).chars().filter(|c| c.is_alphanumeric()).collect();
        let no_digits = core.trim_matches(|c: char| c.is_ascii_digit());
        // cabeçalho de página: o título com o número da página (a 1ª linha é o título de verdade)
        if i > 0 && !head.is_empty() && no_digits == head && core.len() > no_digits.len() {
            continue;
        }
        if fold(l).contains("www.messagehub.info") {
            continue;
        }
        out.push_str(&GLUED.replace(l, "$1 $2"));
        out.push('\n');
    }
    out
}

/// Grava a mensagem com o texto tirado do PDF. Devolve o número de parágrafos (0 = PDF sem texto).
pub fn save(conn: &mut Connection, it: &HubItem, text: &str) -> Result<usize> {
    let parsed = messages::parse_message(&clean_text(text, &it.title), false);
    let Some((date_key, suffix)) = messages::parse_date(&it.code) else { return Ok(0) };
    if parsed.paragraphs.is_empty() {
        return Ok(0);
    }
    let n = parsed.paragraphs.len();
    let tx = conn.transaction()?;
    messages::save_variant(
        &tx,
        &NewVariant {
            source: "hub",
            source_id: it.tm_id.to_string(),
            date_key,
            suffix,
            translation: TRANSLATION.into(),
            title: it.title.clone(),
            local: it.local.clone(),
            pdf_url: String::new(),
            audio_url: String::new(),
            page_url: format!("{HUB}/{LANG}/messages.do"),
            paragraphs: parsed.paragraphs,
        },
    )?;
    tx.commit()?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROWS: &str = r#"<tr class="dataRow" onmouseover="hiOn(this)" onmouseout="hiOff(this)"
                                onclick="selectTranslation(this, 5216, '62')">
                                <td class="leftColumn" style="">60-0515M</td>
<td class="middleColumn" style=""><div class="foreignTitle">O Rei Rejeitado</div><div class="englishTitle">(The Rejected King)</div>
</td>
<td class="middleColumn" style="">Jeffersonville, Indiana, USA</td>
<td class="middleColumn" style="">2017-03-31</td>
<td class="rightColumn" style="">2011-04-05</td>
                            </tr>
                            <tr class="dataRow" onclick="selectTranslation(this, 5160, '62')">
                                <td class="leftColumn" style="">63-0319</td>
<td class="middleColumn" style=""><div class="foreignTitle">O Segundo Selo &amp; Mais</div>
</td>
<td class="middleColumn" style="">Jeffersonville, Indiana, USA</td>
<td class="middleColumn" style="">2017-03-31</td>
<td class="rightColumn" style="">2011-03-23</td>"#;

    #[test]
    fn list_rows() {
        let r = parse_list(ROWS);
        assert_eq!(r.len(), 2);
        assert_eq!(
            r[0],
            HubItem {
                tm_id: 5216,
                code: "60-0515M".into(),
                title: "O Rei Rejeitado".into(),
                title_en: "The Rejected King".into(),
                local: "Jeffersonville, Indiana, USA".into(),
                updated: "2017-03-31".into()
            }
        );
        assert_eq!((r[1].tm_id, r[1].title.as_str(), r[1].title_en.as_str()), (5160, "O Segundo Selo & Mais", ""));
    }

    #[test]
    fn artifacts() {
        let h = r#"<tr class="dataRow" onclick="downloadMessage('63bcaa84bd996785')"><td class="iconCell"><img alt="A4 Book"></td><td class="captionCell">A4 - Book
</td></tr><tr class="dataRow" onclick="downloadMessage('3cf88403700868a9')"><td class="iconCell"></td><td class="captionCell">A4 - Full Sheet
</td></tr><tr onclick="downloadMessage('a1dc288916448ba9')"><td class="captionCell">8.5 x 11 - Full Sheet</td></tr>"#;
        assert_eq!(parse_artifacts(h).as_deref(), Some("3cf88403700868a9"));
        assert_eq!(parse_artifacts("nada"), None);
    }

    #[test]
    fn pdf_text_to_paragraphs() {
        let t = "Um Testemunho Maior Que O De João\nMacon, Georgia, E.U.A\n09 de Junho de 1955\n\n1Muito obrigado. Boa noite, amigos. Estou muito feliz por\nestar aqui esta noite.\n\nE agora, o irmão Thom também é um missionário.\n\n2Veja, a primeira coisa é que o nativo desconfia.\nUm Testemunho Maior Que O De João2\nContinua aqui o parágrafo dois.\n\n3“Se eu O tivesse conhecido,” disse ele.\n\nSermões por\nWilliam Marrion Branham\n\"...nos dias da Voz ...\" Ap. 10:7\n\nwww.messagehub.info\n";
        let p = messages::parse_message(&clean_text(t, "Um Testemunho Maior Que O De João"), false);
        let nums: Vec<u32> = p.paragraphs.iter().map(|x| x.0).collect();
        assert_eq!(nums, vec![1, 2, 3]);
        assert!(p.paragraphs[0].1.starts_with("Muito obrigado.") && p.paragraphs[0].1.ends_with("missionário."), "{}", p.paragraphs[0].1);
        assert_eq!(p.paragraphs[1].1, "Veja, a primeira coisa é que o nativo desconfia. Continua aqui o parágrafo dois.");
        assert_eq!(p.paragraphs[2].1, "“Se eu O tivesse conhecido,” disse ele.");
    }
}
