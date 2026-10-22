mod bible;
mod books;
mod db;
mod error;
mod holyrics;
mod hub;
mod media;
mod messages;
mod msgedit;
mod search;
mod songs;
mod text;
mod themes;
mod transfer;

use error::AppError;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

type Res<T> = Result<T, AppError>;

pub struct AppState {
    db: Mutex<Connection>,
    path: PathBuf,
    data_dir: PathBuf,
    vocab: Mutex<HashMap<&'static str, Arc<search::Vocab>>>,
}

impl AppState {
    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Vocabulário do índice (carregado uma vez; refeito depois de importações).
    fn vocab(&self, which: &'static str) -> Res<Arc<search::Vocab>> {
        if let Some(v) = self.vocab.lock().unwrap().get(which) {
            return Ok(v.clone());
        }
        let (table, content) = match which {
            "songs" => ("songs_fts_vocab", "songs"),
            "texts" => ("texts_fts_vocab", "texts"),
            "verses" => ("verses_fts_vocab", "verses"),
            _ => ("msg_fts_vocab", "msg_paragraphs"),
        };
        // palavras com o nº de registros em que aparecem (para dar peso igual às formas expandidas)
        let (counts, total): (Vec<(String, u64)>, u64) = {
            let c = self.conn();
            let mut st = c.prepare(&format!("SELECT term, doc FROM {table}"))?;
            let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64)))?;
            let counts = rows.filter_map(|r| r.ok()).collect();
            let total: i64 = c.query_row(&format!("SELECT count(*) FROM {content}"), [], |r| r.get(0))?;
            (counts, total as u64)
        };
        let v = Arc::new(search::Vocab::from_counts(counts, total));
        self.vocab.lock().unwrap().insert(which, v.clone());
        Ok(v)
    }

    fn invalidate(&self, which: &'static str) {
        self.vocab.lock().unwrap().remove(which);
    }

    fn holyrics(&self) -> holyrics::HolyricsConfig {
        db::setting(&self.conn(), "holyrics")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
}

// ---------- geral ----------

#[derive(Serialize)]
struct AppInfo {
    db_path: String,
    data_dir: String,
    version: String,
}

#[tauri::command]
async fn app_info(state: State<'_, AppState>, app: tauri::AppHandle) -> Res<AppInfo> {
    Ok(AppInfo {
        db_path: state.path.display().to_string(),
        data_dir: state.data_dir.display().to_string(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Res<HashMap<String, String>> {
    songs::settings(&state.conn())
}

#[tauri::command]
async fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Res<()> {
    db::set_setting(&state.conn(), &key, &value)
}

// ---------- músicas ----------

#[tauri::command]
async fn songs_search(state: State<'_, AppState>, query: String, opts: search::QueryOpts, sort: String) -> Res<songs::SongResults> {
    let v = state.vocab("songs")?;
    songs::search(&state.conn(), &v, &query, &opts, &sort)
}

#[tauri::command]
async fn song_get(state: State<'_, AppState>, id: i64) -> Res<songs::Song> {
    songs::get(&state.conn(), id)
}

#[tauri::command]
async fn song_save(state: State<'_, AppState>, song: songs::Song) -> Res<i64> {
    let id = songs::save(&state.conn(), &song)?;
    state.invalidate("songs");
    Ok(id)
}

#[tauri::command]
async fn song_delete(state: State<'_, AppState>, id: i64) -> Res<()> {
    songs::delete(&state.conn(), id)?;
    state.invalidate("songs");
    Ok(())
}

#[tauri::command]
async fn song_played(state: State<'_, AppState>, id: i64) -> Res<()> {
    songs::mark_played(&state.conn(), id)
}

#[tauri::command]
async fn songs_import(state: State<'_, AppState>, songs: Vec<songs::Song>, on_duplicate: String) -> Res<songs::ImportResult> {
    let r = songs::import(&mut state.conn(), &songs, &on_duplicate)?;
    state.invalidate("songs");
    Ok(r)
}

// ---------- textos ----------

#[tauri::command]
async fn texts_list(state: State<'_, AppState>, query: String) -> Res<Vec<songs::TextDoc>> {
    let v = state.vocab("texts")?;
    songs::list_texts(&state.conn(), &query, &v)
}

#[tauri::command]
async fn text_get(state: State<'_, AppState>, id: i64) -> Res<songs::TextDoc> {
    songs::get_text(&state.conn(), id)
}

#[tauri::command]
async fn text_save(state: State<'_, AppState>, doc: songs::TextDoc) -> Res<i64> {
    let id = songs::save_text(&state.conn(), &doc)?;
    state.invalidate("texts");
    Ok(id)
}

#[tauri::command]
async fn text_delete(state: State<'_, AppState>, id: i64) -> Res<()> {
    songs::delete_text(&state.conn(), id)?;
    state.invalidate("texts");
    Ok(())
}

// ---------- Bíblia ----------

#[tauri::command]
async fn bible_books() -> Res<Vec<bible::BookInfo>> {
    Ok(bible::books())
}

#[tauri::command]
async fn bible_list(state: State<'_, AppState>) -> Res<Vec<bible::BibleInfo>> {
    bible::list(&state.conn())
}

#[tauri::command]
async fn bible_chapter(state: State<'_, AppState>, bibles: Vec<String>, book: u32, chapter: u32) -> Res<Vec<bible::ChapterVerse>> {
    bible::chapter(&state.conn(), &bibles, book, chapter)
}

#[tauri::command]
async fn bible_chapter_counts(state: State<'_, AppState>, bible: String) -> Res<Vec<u32>> {
    bible::chapter_counts(&state.conn(), &bible)
}

#[tauri::command]
async fn bible_parse_ref(input: String) -> Res<Option<bible::VerseRef>> {
    Ok(bible::parse_ref(&input))
}

#[tauri::command]
async fn bible_search(state: State<'_, AppState>, q: bible::VerseSearch) -> Res<bible::VerseResults> {
    let v = state.vocab("verses")?;
    bible::search(&state.conn(), &v, &q)
}

#[tauri::command]
async fn bible_import_verses(state: State<'_, AppState>, meta: bible::BibleMeta, verses: Vec<(u32, u32, u32, String)>) -> Res<usize> {
    let n = bible::save_bible(&mut state.conn(), &meta, &verses)?;
    state.invalidate("verses");
    Ok(n)
}

#[tauri::command]
async fn bible_import_mybible(state: State<'_, AppState>, path: String, meta: bible::BibleMeta) -> Res<usize> {
    let p = PathBuf::from(&path);
    let (desc, verses) = tauri::async_runtime::spawn_blocking(move || bible::read_mybible(&p))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    let mut meta = meta;
    if meta.name.trim().is_empty() {
        meta.name = desc.unwrap_or_else(|| meta.abbrev.clone());
    }
    let n = bible::save_bible(&mut state.conn(), &meta, &verses)?;
    state.invalidate("verses");
    Ok(n)
}

#[derive(Serialize)]
struct FoundBible {
    path: String,
    abbrev: String,
    name: String,
    license: String,
    language: String,
}

/// Bíblias livres do EasySlides instaladas neste PC (formato MyBible).
#[tauri::command]
async fn bible_scan_easyslides(app: tauri::AppHandle) -> Res<Vec<FoundBible>> {
    let docs = app.path().document_dir()?;
    let admin = docs.join("EasyslidesData").join("Admin");
    let mut out = vec![];
    let catalog = Connection::open_with_flags(admin.join("Settings").join("BiblesAdmin.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok();
    let mut meta: HashMap<String, (String, String, String, String)> = HashMap::new();
    if let Some(c) = &catalog {
        if let Ok(mut st) = c.prepare("SELECT * FROM bibles") {
            if let Ok(rows) = st.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(4)?, r.get::<_, String>(5)?))
            }) {
                for (file, name, abbrev, license, lang) in rows.flatten() {
                    meta.insert(file.to_lowercase(), (name, abbrev, license, lang));
                }
            }
        }
    }
    if let Ok(dir) = std::fs::read_dir(admin.join("HolyBibles")) {
        for e in dir.flatten() {
            let file = e.file_name().to_string_lossy().to_string();
            let (name, abbrev, license, lang) = meta
                .get(&file.to_lowercase())
                .cloned()
                .unwrap_or_else(|| (file.clone(), file.split('.').next().unwrap_or("").to_uppercase(), String::new(), String::new()));
            out.push(FoundBible { path: e.path().display().to_string(), abbrev, name, license, language: lang });
        }
    }
    Ok(out)
}

/// Baixa uma versão livre do eBible.org (formato VPL) e grava.
#[tauri::command]
async fn bible_download_ebible(state: State<'_, AppState>, meta: bible::BibleMeta) -> Res<usize> {
    let url = format!("https://ebible.org/Scriptures/{}_vpl.zip", meta.id);
    let bytes = reqwest::get(&url).await?.error_for_status()?.bytes().await?;
    let verses = tauri::async_runtime::spawn_blocking(move || -> Res<Vec<(u32, u32, u32, String)>> {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))?;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i)?;
            if f.name().map(|n| n.ends_with("_vpl.txt")).unwrap_or(false) {
                let mut s = String::new();
                std::io::Read::read_to_string(&mut f, &mut s)?;
                return Ok(bible::parse_vpl(&s));
            }
        }
        Err(AppError::msg("arquivo VPL não encontrado no zip"))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;
    let n = bible::save_bible(&mut state.conn(), &meta, &verses)?;
    state.invalidate("verses");
    Ok(n)
}

#[tauri::command]
async fn bible_delete(state: State<'_, AppState>, id: String) -> Res<()> {
    bible::delete_bible(&state.conn(), &id)?;
    state.invalidate("verses");
    Ok(())
}

// ---------- mensagens ----------

#[tauri::command]
async fn msg_stats(state: State<'_, AppState>) -> Res<messages::MsgStats> {
    messages::stats(&state.conn())
}

#[tauri::command]
async fn msg_list(state: State<'_, AppState>, q: messages::ListQuery) -> Res<messages::GroupList> {
    messages::list_groups(&state.conn(), &q)
}

#[tauri::command]
async fn msg_group(state: State<'_, AppState>, id: i64) -> Res<messages::GroupInfo> {
    let c = state.conn();
    let mut g = messages::group(&c, id)?;
    let edited = msgedit::edited_in_group(&c, id)?;
    for v in &mut g.variants {
        v.edited = edited.contains(&v.id);
    }
    Ok(g)
}

/// Corrige o texto de um parágrafo (a tradução fica marcada como editada).
#[tauri::command]
async fn msg_para_save(state: State<'_, AppState>, variant_id: i64, seq: i64, text: String) -> Res<()> {
    msgedit::save_paragraph(&mut state.conn(), variant_id, seq, &text)?;
    state.invalidate("msg");
    Ok(())
}

/// Junta o parágrafo ao seguinte.
#[tauri::command]
async fn msg_para_join(state: State<'_, AppState>, variant_id: i64, seq: i64) -> Res<bool> {
    let ok = msgedit::join_next(&mut state.conn(), variant_id, seq)?;
    state.invalidate("msg");
    Ok(ok)
}

/// Desfaz as edições da tradução (volta ao texto original).
#[tauri::command]
async fn msg_edits_undo(state: State<'_, AppState>, variant_id: i64) -> Res<bool> {
    let ok = msgedit::undo(&mut state.conn(), variant_id)?;
    state.invalidate("msg");
    Ok(ok)
}

#[tauri::command]
async fn msg_paragraphs(state: State<'_, AppState>, variant_id: i64) -> Res<Vec<messages::Paragraph>> {
    messages::paragraphs(&state.conn(), variant_id)
}

#[tauri::command]
async fn msg_set_preferred(state: State<'_, AppState>, group_id: i64, variant_id: i64) -> Res<()> {
    messages::set_preferred(&state.conn(), group_id, variant_id)
}

#[tauri::command]
async fn msg_search(state: State<'_, AppState>, q: messages::MsgSearch) -> Res<messages::MsgResults> {
    let v = state.vocab("msg")?;
    messages::search_messages(&state.conn(), &v, &q)
}

/// Sugestões ao digitar na pesquisa de mensagens (palavras do índice e títulos).
#[tauri::command]
async fn msg_suggest(state: State<'_, AppState>, input: String) -> Res<messages::Suggestions> {
    messages::suggest(&state.conn(), &input)
}

/// Caminho padrão do banco de mensagens (pasta AVDP Busca\database-mensagens).
#[tauri::command]
async fn msg_default_local_path(app: tauri::AppHandle) -> Res<Option<String>> {
    let mut candidates = vec![];
    if let Ok(docs) = app.path().document_dir() {
        candidates.push(docs.join("Claude").join("AVDP").join("AVDP Busca").join("database-mensagens").join("mensagens.db"));
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().take(6) {
            candidates.push(anc.join("database-mensagens").join("mensagens.db"));
        }
    }
    Ok(candidates.into_iter().find(|p| p.exists()).map(|p| p.display().to_string()))
}

#[tauri::command]
async fn msg_import_local(state: State<'_, AppState>, path: String) -> Res<messages::ImportReport> {
    let db_path = state.path.clone();
    let rep = tauri::async_runtime::spawn_blocking(move || -> Res<messages::ImportReport> {
        let mut c = db::open(&db_path)?;
        let rep = messages::import_local_db(&mut c, std::path::Path::new(&path))?;
        messages::tidy_groups(&mut c)?;
        Ok(rep)
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;
    state.invalidate("msg");
    db::set_setting(&state.conn(), "msg_local_path_imported", &chrono_now())?;
    Ok(rep)
}

fn chrono_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}

/// Baixa as mensagens do Busca CBB pela API pública do site (página a página).
#[tauri::command]
async fn msg_sync_cbb(state: State<'_, AppState>, app: tauri::AppHandle) -> Res<usize> {
    let client = reqwest::Client::builder()
        .user_agent("AVDP-Busca/0.1")
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let per = 25;
    let mut page = 1;
    let mut done = 0usize;
    let mut conn = Some(db::open(&state.path)?);
    loop {
        let res: messages::CbbPage = client
            .post(messages::CBB_URL)
            .json(&json!({ "pagina": page, "itensPorPagina": per }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let total = res.total.unwrap_or(0);
        if res.data.is_empty() {
            break;
        }
        let items = res.data;
        let n_items = items.len();
        let mut c = conn.take().unwrap();
        let (c, n) = tauri::async_runtime::spawn_blocking(move || -> Res<(Connection, usize)> {
            let n = messages::save_cbb_items(&mut c, &items)?;
            Ok((c, n))
        })
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
        conn = Some(c);
        done += n;
        let _ = app.emit("msg-sync", json!({ "done": done, "total": total }));
        if n_items < per || (total > 0 && (page * per) as i64 >= total) {
            break;
        }
        page += 1;
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    if let Some(mut c) = conn.take() {
        tauri::async_runtime::spawn_blocking(move || messages::tidy_groups(&mut c))
            .await
            .map_err(|e| AppError::msg(e.to_string()))??;
    }
    state.invalidate("msg");
    db::set_setting(&state.conn(), "cbb_synced_at", &chrono_now())?;
    Ok(done)
}

/// GET na API do Tabernáculo da Fé, com espera quando o site pede calma (429) ou falha de passagem.
async fn tdf_get<T: serde::de::DeserializeOwned>(client: &reqwest::Client, url: &str) -> Res<T> {
    let mut wait = 2u64;
    for attempt in 0..6 {
        let res = client.get(url).send().await;
        match res {
            Ok(r) if r.status().is_success() => return Ok(r.json().await?),
            Ok(r) if attempt < 5 && (r.status().as_u16() == 429 || r.status().is_server_error()) => {
                let after = r.headers().get("retry-after").and_then(|h| h.to_str().ok()).and_then(|s| s.parse::<u64>().ok());
                tokio::time::sleep(std::time::Duration::from_secs(after.unwrap_or(wait).min(60))).await;
            }
            Ok(r) => return Err(AppError::msg(format!("Tabernáculo da Fé respondeu {} em {url}", r.status()))),
            Err(e) if attempt < 5 && (e.is_timeout() || e.is_connect()) => tokio::time::sleep(std::time::Duration::from_secs(wait)).await,
            Err(e) => return Err(e.into()),
        }
        wait = (wait * 2).min(30);
    }
    Err(AppError::msg("Tabernáculo da Fé não respondeu"))
}

#[derive(Serialize)]
struct TdfReport {
    /// Mensagens no site.
    total: usize,
    /// Baixadas agora (novas ou revisadas).
    downloaded: usize,
    /// Cópias antigas iguais escondidas (banco local / Busca CBB).
    superseded: i64,
}

/// Baixa as mensagens do Tabernáculo da Fé (busca.tabernaculodafe.org.br) pela API pública do site.
/// Da segunda vez em diante só baixa o texto das mensagens novas ou revisadas pelo site.
#[tauri::command]
async fn msg_sync_tdf(state: State<'_, AppState>, app: tauri::AppHandle) -> Res<TdfReport> {
    let client = reqwest::Client::builder()
        .user_agent("AVDP-Busca/0.1")
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let titles: Vec<messages::TdfTitle> = tdf_get(&client, &format!("{}messageGetTitles?orderBy=date", messages::TDF_API)).await?;
    let total = titles.len();
    // revisão de cada mensagem já baixada; só vale se a mensagem ainda está no banco
    let mut versions: HashMap<String, i64> = db::setting(&state.conn(), "tdf_versions")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let stored: std::collections::HashSet<String> = {
        let c = state.conn();
        let mut st = c.prepare("SELECT source_id FROM msg_variants WHERE source='tdf' AND para_count > 0")?;
        let rows = st.query_map([], |r| r.get(0))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    let mut per_date: HashMap<&str, usize> = HashMap::new();
    for t in &titles {
        *per_date.entry(t.date.as_str()).or_default() += 1;
    }
    let mut conn = Some(db::open(&state.path)?);
    let mut downloaded = 0usize;
    for (i, t) in titles.iter().enumerate() {
        if versions.get(&t.code) == Some(&t.version) && stored.contains(&t.code) {
            let _ = app.emit("msg-sync", json!({ "done": i + 1, "total": total }));
            continue;
        }
        let paras: Vec<messages::TdfParagraph> = tdf_get(&client, &format!("{}messageGetParagraphs?codeId={}", messages::TDF_API, t.code)).await?;
        let strict = per_date.get(t.date.as_str()).copied().unwrap_or(0) > 1;
        let (mut c, title) = (conn.take().unwrap(), t.clone());
        let (c, saved) = tauri::async_runtime::spawn_blocking(move || -> Res<(Connection, bool)> {
            let saved = messages::save_tdf_message(&mut c, &title, &paras, strict)?;
            Ok((c, saved))
        })
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
        conn = Some(c);
        if saved {
            downloaded += 1;
            versions.insert(t.code.clone(), t.version);
        }
        let _ = app.emit("msg-sync", json!({ "done": i + 1, "total": total }));
        // guarda o progresso de tempos em tempos: interrompida, a próxima continua daqui
        if downloaded % 20 == 0 {
            db::set_setting(&state.conn(), "tdf_versions", &serde_json::to_string(&versions)?)?;
        }
        tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    }
    db::set_setting(&state.conn(), "tdf_versions", &serde_json::to_string(&versions)?)?;
    let mut c = conn.take().unwrap();
    let superseded = tauri::async_runtime::spawn_blocking(move || -> Res<i64> {
        messages::tidy_groups(&mut c)?;
        Ok(c.query_row("SELECT count(*) FROM msg_variants WHERE superseded_by IS NOT NULL", [], |r| r.get(0))?)
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;
    state.invalidate("msg");
    db::set_setting(&state.conn(), "tdf_synced_at", &chrono_now())?;
    Ok(TdfReport { total, downloaded, superseded })
}

// ---------- livros (Eras) e série dos Selos, de um zip ou pasta de TXT ----------

/// Importa os TXT do zip/pasta: capítulos do livro das Eras e as mensagens dos Selos (essas só se o
/// texto ainda não estiver no banco).
#[tauri::command]
async fn msg_import_books(state: State<'_, AppState>, path: String) -> Res<books::BooksReport> {
    let files = books::read_txt_files(std::path::Path::new(&path))?;
    if files.is_empty() {
        return Err(AppError::msg("Nenhum arquivo .txt neste zip/pasta."));
    }
    let rep = {
        let mut c = state.conn();
        let rep = books::import(&mut c, &files)?;
        if rep.selos_new > 0 {
            messages::tidy_groups(&mut c)?;
        }
        rep
    };
    state.invalidate("msg");
    Ok(rep)
}

// ---------- MessageHub (Português-B) ----------

fn hub_client() -> Res<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent("AVDP-Busca/1.1")
        .timeout(std::time::Duration::from_secs(60))
        .build()?)
}

/// Pedido ao MessageHub, esperando e tentando de novo quando o site pede calma ou falha de passagem.
async fn hub_send(req: impl Fn() -> reqwest::RequestBuilder) -> Res<reqwest::Response> {
    let mut wait = 2u64;
    for attempt in 0..5 {
        match req().send().await {
            Ok(r) if r.status().is_success() => return Ok(r),
            Ok(r) if attempt < 4 && (r.status().as_u16() == 429 || r.status().is_server_error()) => {}
            Ok(r) => return Err(AppError::msg(format!("MessageHub respondeu {}", r.status()))),
            Err(e) if attempt < 4 && (e.is_timeout() || e.is_connect()) => {}
            Err(e) => return Err(e.into()),
        }
        tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
        wait = (wait * 2).min(30);
    }
    Err(AppError::msg("MessageHub não respondeu"))
}

#[derive(Serialize)]
struct HubEntry {
    #[serde(flatten)]
    item: hub::HubItem,
    /// Nova ou revisada pelo site desde a última vez: precisa baixar.
    need: bool,
}

/// Lista das mensagens em Português-B do site, marcando as que precisam ser baixadas.
#[tauri::command]
async fn hub_list(state: State<'_, AppState>) -> Res<Vec<HubEntry>> {
    let client = hub_client()?;
    let url = format!("{}/{}/message_list_records.do", hub::HUB, hub::LANG);
    let mut items: Vec<hub::HubItem> = vec![];
    for page in 1..=100u32 {
        let form = [
            ("tableCode", "TranslatedMessages".to_string()),
            ("sortColumn", String::new()),
            ("sortDirection", String::new()),
            ("page", page.to_string()),
            ("filterParameters", String::new()),
            ("languageId", hub::LANG_ID.to_string()),
            ("show_en", String::new()),
            ("format", "Book".to_string()),
            ("filterText", String::new()),
        ];
        // corpo do formulário (os valores são simples: letras e números)
        let body: String = form.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
        let html = hub_send(|| client.post(&url).header("Content-Type", "application/x-www-form-urlencoded").body(body.clone())).await?.text().await?;
        let rows = hub::parse_list(&html);
        let n = rows.len();
        let before = items.len();
        for r in rows {
            if !items.iter().any(|x| x.tm_id == r.tm_id) {
                items.push(r);
            }
        }
        if n < 30 || items.len() == before {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    if items.is_empty() {
        return Err(AppError::msg("O MessageHub não devolveu nenhuma mensagem (o site mudou?)."));
    }
    let versions: HashMap<String, String> = db::setting(&state.conn(), "hub_versions")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let stored: std::collections::HashSet<String> = {
        let c = state.conn();
        let mut st = c.prepare("SELECT source_id FROM msg_variants WHERE source='hub' AND para_count > 0")?;
        let rows = st.query_map([], |r| r.get(0))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    Ok(items
        .into_iter()
        .map(|it| {
            let id = it.tm_id.to_string();
            let need = versions.get(&id) != Some(&it.updated) || !stored.contains(&id);
            HubEntry { item: it, need }
        })
        .collect())
}

/// PDF de uma mensagem do MessageHub (bytes; o texto é tirado no front).
#[tauri::command]
async fn hub_pdf(tm_id: i64) -> Res<tauri::ipc::Response> {
    let client = hub_client()?;
    let url = format!("{}/{}/message_artifacts.do?tmId={tm_id}&languageId={}&format=Book", hub::HUB, hub::LANG, hub::LANG_ID);
    let html = hub_send(|| client.get(&url)).await?.text().await?;
    let eid = hub::parse_artifacts(&html).ok_or_else(|| AppError::msg("mensagem sem PDF no MessageHub"))?;
    let pdf = format!("{}/download.message?eid={eid}", hub::HUB);
    let bytes = hub_send(|| client.get(&pdf)).await?.bytes().await?;
    if !bytes.starts_with(b"%PDF") {
        return Err(AppError::msg("o MessageHub não devolveu um PDF"));
    }
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

/// Grava a mensagem com o texto do PDF e guarda a revisão ("Atualizada em"). Devolve o nº de parágrafos.
#[tauri::command]
async fn hub_save(state: State<'_, AppState>, item: hub::HubItem, text: String) -> Res<usize> {
    let mut c = state.conn();
    let n = hub::save(&mut c, &item, &text)?;
    if n > 0 {
        let mut versions: HashMap<String, String> = db::setting(&c, "hub_versions")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        versions.insert(item.tm_id.to_string(), item.updated.clone());
        db::set_setting(&c, "hub_versions", &serde_json::to_string(&versions)?)?;
    }
    Ok(n)
}

/// Fim da sincronização: arruma os grupos, esconde as cópias antigas iguais e refaz o vocabulário.
#[tauri::command]
async fn hub_finish(state: State<'_, AppState>) -> Res<i64> {
    let mut c = db::open(&state.path)?;
    let superseded = tauri::async_runtime::spawn_blocking(move || -> Res<i64> {
        messages::tidy_groups(&mut c)?;
        Ok(c.query_row("SELECT count(*) FROM msg_variants WHERE superseded_by IS NOT NULL", [], |r| r.get(0))?)
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;
    state.invalidate("msg");
    db::set_setting(&state.conn(), "hub_synced_at", &chrono_now())?;
    Ok(superseded)
}

// ---------- levar a lista para outro PC ----------

fn computer_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "outro PC".into())
}

/// Parágrafos de uma mensagem do Tabernáculo da Fé, numa tentativa só (sem internet: `None`).
async fn tdf_fetch_once(client: &reqwest::Client, code: &str) -> Option<Vec<messages::TdfParagraph>> {
    let url = format!("{}messageGetParagraphs?codeId={code}", messages::TDF_API);
    let rows: Vec<messages::TdfParagraph> = client.get(&url).send().await.ok()?.error_for_status().ok()?.json().await.ok()?;
    (!rows.is_empty()).then_some(rows)
}

/// Exporta a lista de reprodução para um arquivo `.avdpfila` (para importar em outro computador).
#[tauri::command]
async fn fila_export(state: State<'_, AppState>, playlist_id: i64, path: String) -> Res<usize> {
    let f = transfer::export(&state.conn(), playlist_id, &computer_name())?;
    std::fs::write(&path, serde_json::to_vec_pretty(&f)?)?;
    Ok(f.items.len())
}

/// Importa um arquivo `.avdpfila`. Mensagem do Tabernáculo da Fé que falta é baixada do site
/// (uma tentativa, sem esperar); as outras, ou sem internet, vêm do texto que está no arquivo.
#[tauri::command]
async fn fila_import(state: State<'_, AppState>, path: String) -> Res<transfer::FilaReport> {
    let raw = std::fs::read(&path)?;
    let f: transfer::FilaFile = serde_json::from_slice(&raw).map_err(|e| AppError::msg(format!("arquivo de fila inválido: {e}")))?;
    if f.kind != transfer::KIND {
        return Err(AppError::msg("este arquivo não é uma fila do AVDP Busca"));
    }
    let missing = transfer::missing_tdf(&state.conn(), &f)?;
    let mut downloaded: HashMap<String, Vec<messages::TdfParagraph>> = HashMap::new();
    if !missing.is_empty() {
        let client = reqwest::Client::builder().user_agent("AVDP-Busca/1.0").timeout(std::time::Duration::from_secs(20)).build()?;
        for code in missing {
            if let Some(rows) = tdf_fetch_once(&client, &code).await {
                downloaded.insert(code, rows);
            }
        }
    }
    let mut imports: HashMap<String, i64> = db::setting(&state.conn(), "fila_imports")?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let db_path = state.path.clone();
    let (rep, imports) = tauri::async_runtime::spawn_blocking(move || -> Res<(transfer::FilaReport, HashMap<String, i64>)> {
        let mut c = db::open(&db_path)?;
        let rep = transfer::import(&mut c, &f, &downloaded, &mut imports)?;
        Ok((rep, imports))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;
    db::set_setting(&state.conn(), "fila_imports", &serde_json::to_string(&imports)?)?;
    if rep.messages_downloaded + rep.messages_from_file > 0 {
        state.invalidate("msg");
    }
    Ok(rep)
}

// ---------- histórico ----------

#[tauri::command]
async fn history_add(state: State<'_, AppState>, scope: String, query: String, opts: String, hits: i64) -> Res<()> {
    songs::add_history(&state.conn(), &scope, &query, &opts, hits)
}

#[tauri::command]
async fn history_list(state: State<'_, AppState>, scope: String) -> Res<Vec<songs::HistoryItem>> {
    songs::history(&state.conn(), &scope)
}

#[tauri::command]
async fn history_clear(state: State<'_, AppState>, scope: String) -> Res<()> {
    songs::clear_history(&state.conn(), &scope)
}

// ---------- temas ----------

#[tauri::command]
async fn themes_list(state: State<'_, AppState>) -> Res<Vec<themes::Theme>> {
    themes::list(&state.conn())
}

#[tauri::command]
async fn theme_save(state: State<'_, AppState>, theme: themes::Theme) -> Res<i64> {
    themes::save(&state.conn(), &theme)
}

#[tauri::command]
async fn theme_delete(state: State<'_, AppState>, id: i64) -> Res<()> {
    themes::delete(&state.conn(), id)
}

/// Copia uma imagem de fundo para a pasta do app e devolve o novo caminho.
#[tauri::command]
async fn theme_store_image(state: State<'_, AppState>, path: String) -> Res<String> {
    let src = PathBuf::from(&path);
    let dir = state.data_dir.join("fundos");
    std::fs::create_dir_all(&dir)?;
    let name = src.file_name().ok_or_else(|| AppError::msg("arquivo inválido"))?;
    let dst = dir.join(name);
    if src != dst {
        std::fs::copy(&src, &dst)?;
    }
    Ok(dst.display().to_string())
}

// ---------- listas ----------

#[tauri::command]
async fn playlists_list(state: State<'_, AppState>) -> Res<Vec<songs::Playlist>> {
    songs::playlists(&state.conn())
}

#[tauri::command]
async fn playlist_create(state: State<'_, AppState>, name: String) -> Res<i64> {
    songs::create_playlist(&state.conn(), &name)
}

#[tauri::command]
async fn playlist_rename(state: State<'_, AppState>, id: i64, name: String) -> Res<()> {
    songs::rename_playlist(&state.conn(), id, &name)
}

#[tauri::command]
async fn playlist_delete(state: State<'_, AppState>, id: i64) -> Res<()> {
    songs::delete_playlist(&state.conn(), id)
}

#[tauri::command]
async fn playlist_items(state: State<'_, AppState>, id: i64) -> Res<Vec<songs::PlaylistItem>> {
    songs::playlist_items(&state.conn(), id)
}

#[tauri::command]
async fn playlist_set_items(state: State<'_, AppState>, id: i64, items: Vec<songs::PlaylistItem>) -> Res<()> {
    songs::set_playlist_items(&mut state.conn(), id, &items)
}

// ---------- Holyrics ----------

#[tauri::command]
async fn holyrics_versions(state: State<'_, AppState>) -> Res<serde_json::Value> {
    let cfg = state.holyrics();
    holyrics::versions(&cfg).await
}

#[tauri::command]
async fn holyrics_show_verse(state: State<'_, AppState>, ids: Vec<String>, version: Option<String>) -> Res<()> {
    let cfg = state.holyrics();
    holyrics::show_verse(&cfg, ids, version).await
}

#[tauri::command]
async fn holyrics_show_slides(state: State<'_, AppState>, slides: Vec<String>) -> Res<()> {
    let cfg = state.holyrics();
    holyrics::show_slides(&cfg, slides).await
}

/// Ações do Holyrics que o app pode disparar (lista fechada).
const HOLYRICS_ACTIONS: &[&str] = &[
    "ShowVerse",
    "ShowQuickPresentation",
    "ActionNext",
    "ActionPrevious",
    "ActionGoToIndex",
    "SetF8",
    "SetF9",
    "SetF10",
    "ToggleF8",
    "ToggleF9",
    "ToggleF10",
    "CloseCurrentPresentation",
    "GetCurrentPresentation",
    "GetBibleVersionsV2",
    // exportar a lista do AVDP para a lista de reprodução do Holyrics (grátis; só `event_id` é pago, e não é usado)
    "SearchLyrics",
    "AddToPlaylist",
    "GetCurrentSchedule",
    "CheckPermissions",
];

#[tauri::command]
async fn holyrics_call(state: State<'_, AppState>, action: String, body: serde_json::Value) -> Res<serde_json::Value> {
    if !HOLYRICS_ACTIONS.contains(&action.as_str()) {
        return Err(AppError::msg(format!("ação do Holyrics não permitida: {action}")));
    }
    let cfg = state.holyrics();
    holyrics::call(&cfg, &action, body).await
}

// ---------- mídia ----------

#[tauri::command]
async fn media_list(state: State<'_, AppState>, kind: String, query: String) -> Res<Vec<media::MediaFile>> {
    media::list(&state.conn(), &kind, &query)
}

#[tauri::command]
async fn media_add(state: State<'_, AppState>, app: tauri::AppHandle, paths: Vec<String>) -> Res<usize> {
    let added = media::add_paths(&state.conn(), &paths)?;
    let scope = app.asset_protocol_scope();
    for f in &added {
        let _ = scope.allow_file(f);
    }
    Ok(added.len())
}

#[tauri::command]
async fn media_remove(state: State<'_, AppState>, id: i64) -> Res<()> {
    media::remove(&state.conn(), id)
}

/// Libera um arquivo escolhido pelo usuário para exibição (papel de parede, fundo).
#[tauri::command]
async fn allow_file(app: tauri::AppHandle, path: String) -> Res<()> {
    app.asset_protocol_scope().allow_file(&path).map_err(|e| AppError::msg(e.to_string()))
}

// ---------- projeção ----------

#[derive(Serialize)]
struct MonitorInfo {
    index: usize,
    name: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    primary: bool,
}

#[tauri::command]
async fn monitors_list(app: tauri::AppHandle) -> Res<Vec<MonitorInfo>> {
    let primary = app.primary_monitor()?.map(|m| (m.position().x, m.position().y));
    Ok(app
        .available_monitors()?
        .into_iter()
        .enumerate()
        .map(|(i, m)| MonitorInfo {
            index: i,
            name: m.name().cloned().unwrap_or_else(|| format!("Monitor {}", i + 1)),
            width: m.size().width,
            height: m.size().height,
            x: m.position().x,
            y: m.position().y,
            primary: Some((m.position().x, m.position().y)) == primary,
        })
        .collect())
}

/// Abre (ou move) a janela de projeção. `monitor` = None abre em janela comum.
#[tauri::command]
async fn projection_open(app: tauri::AppHandle, monitor: Option<usize>) -> Res<()> {
    open_output(&app, "projection", "index.html#/projection", "AVDP Busca — Projeção", monitor)
}

/// Tela de palco/retorno: slide atual, próximo, anotação e relógio, num monitor à parte.
#[tauri::command]
async fn stage_open(app: tauri::AppHandle, monitor: Option<usize>) -> Res<()> {
    open_output(&app, "stage", "index.html#/stage", "AVDP Busca — Palco", monitor)
}

#[tauri::command]
async fn stage_close(app: tauri::AppHandle) -> Res<()> {
    if let Some(w) = app.get_webview_window("stage") {
        w.close()?;
    }
    Ok(())
}

/// Janela de saída (projeção ou palco) em tela cheia no monitor escolhido, ou em janela comum.
fn open_output(app: &tauri::AppHandle, label: &str, url: &str, title: &str, monitor: Option<usize>) -> Res<()> {
    let target = match monitor {
        Some(i) => app.available_monitors()?.into_iter().nth(i),
        None => None,
    };
    let win = match app.get_webview_window(label) {
        Some(w) => w,
        None => WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
            .title(title)
            .inner_size(960.0, 540.0)
            .visible(false)
            .build()?,
    };
    win.set_fullscreen(false)?;
    match target {
        Some(m) => {
            win.set_decorations(false)?;
            win.set_position(*m.position())?;
            win.set_size(*m.size())?;
            win.set_always_on_top(true)?;
            win.set_fullscreen(true)?;
        }
        None => {
            win.set_decorations(true)?;
            win.set_always_on_top(false)?;
            win.set_size(tauri::LogicalSize::new(960.0, 540.0))?;
        }
    }
    win.show()?;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    Ok(())
}

#[tauri::command]
async fn projection_close(app: tauri::AppHandle) -> Res<()> {
    if let Some(w) = app.get_webview_window("projection") {
        w.close()?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // testes automáticos: AVDP_DATA_DIR aponta outra pasta de dados (uma cópia do banco), para o
            // teste nunca abrir o banco do Isaac. Sem a variável, é a pasta normal (%APPDATA%\br.avdp.busca).
            let test_dir = std::env::var_os("AVDP_DATA_DIR").map(PathBuf::from);
            let dir = match &test_dir {
                Some(d) => d.clone(),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&dir)?;
            if test_dir.is_some() {
                let _ = app.asset_protocol_scope().allow_directory(&dir, true);
            }
            let path = dir.join("avdp.db");
            let conn = db::open(&path).map_err(|e| e.to_string())?;
            // banco trazido de outro PC: fundos e papel de parede apontam para a pasta de dados daqui
            let _ = db::relocate_data_dir(&conn, &dir);
            // arquivos da biblioteca de mídia podem ser exibidos
            let scope = app.asset_protocol_scope();
            for p in media::all_paths(&conn).unwrap_or_default() {
                let _ = scope.allow_file(&p);
            }
            app.manage(AppState { db: Mutex::new(conn), path, data_dir: dir, vocab: Mutex::new(HashMap::new()) });
            Ok(())
        })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Destroyed = e {
                match w.label() {
                    "main" => w.app_handle().exit(0),
                    "projection" => {
                        let _ = w.app_handle().emit("projection-closed", ());
                    }
                    "stage" => {
                        let _ = w.app_handle().emit("stage-closed", ());
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            get_settings,
            set_setting,
            songs_search,
            song_get,
            song_save,
            song_delete,
            song_played,
            songs_import,
            texts_list,
            text_get,
            text_save,
            text_delete,
            bible_books,
            bible_list,
            bible_chapter,
            bible_chapter_counts,
            bible_parse_ref,
            bible_search,
            bible_import_verses,
            bible_import_mybible,
            bible_scan_easyslides,
            bible_download_ebible,
            bible_delete,
            msg_stats,
            msg_list,
            msg_group,
            msg_paragraphs,
            msg_set_preferred,
            msg_search,
            msg_default_local_path,
            msg_import_local,
            msg_sync_cbb,
            msg_sync_tdf,
            msg_import_books,
            msg_para_save,
            msg_para_join,
            msg_edits_undo,
            hub_list,
            hub_pdf,
            hub_save,
            hub_finish,
            fila_export,
            fila_import,
            history_add,
            history_list,
            history_clear,
            themes_list,
            theme_save,
            theme_delete,
            theme_store_image,
            playlists_list,
            playlist_create,
            playlist_rename,
            playlist_delete,
            playlist_items,
            playlist_set_items,
            holyrics_versions,
            holyrics_show_verse,
            holyrics_show_slides,
            holyrics_call,
            media_list,
            media_add,
            media_remove,
            allow_file,
            monitors_list,
            projection_open,
            projection_close,
            stage_open,
            stage_close,
            msg_suggest,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o AVDP Busca");
}

#[cfg(test)]
mod net_tests {
    /// Usa a internet: cargo test --lib tdf_download_and_import -- --ignored
    #[test]
    #[ignore]
    fn tdf_download_and_import() {
        let client = reqwest::Client::builder().user_agent("AVDP-Busca/1.0").build().unwrap();
        let rows = tauri::async_runtime::block_on(super::tdf_fetch_once(&client, "WMBB74935A5ABE4")).expect("o site respondeu");
        assert!(rows.len() > 30 && rows[0].title.contains("ANJO") && rows[0].date == "19480304", "{:?}", &rows[0]);
        let mut c = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&c).unwrap();
        let file: crate::transfer::FilaFile = serde_json::from_value(serde_json::json!({
            "kind": "avdp-fila", "version": 1, "id": "PC-A#1#0", "name": "Teste", "from": "PC-A",
            "items": [{ "kind": "message", "label": "48-0304 O Anjo de Deus — §2", "ref": {},
                        "message": { "code": "48-0304", "date_key": "1948-0304", "source": "tdf", "source_id": "WMBB74935A5ABE4", "translation": "GO", "title": "O Anjo de Deus", "num": 2, "paragraphs": [] } }]
        }))
        .unwrap();
        let mut down = std::collections::HashMap::new();
        down.insert("WMBB74935A5ABE4".to_string(), rows);
        let rep = crate::transfer::import(&mut c, &file, &down, &mut std::collections::HashMap::new()).unwrap();
        assert_eq!((rep.items, rep.messages_downloaded), (1, 1), "{rep:?}");
        let (code, title): (String, String) = c.query_row("SELECT g.code, v.title FROM msg_variants v JOIN msg_groups g ON g.id=v.group_id", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((code.as_str(), title.as_str()), ("48-0304", "O Anjo de Deus"));
    }
}
