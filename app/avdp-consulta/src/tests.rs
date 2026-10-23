//! Testes de ponta a ponta: banco do AVDP de exemplo → `make-db` → comandos como o módulo chama.

use crate::args::Args;
use crate::messages::{self, NewVariant};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn hex(s: &str) -> String {
    format!("x:{}", s.bytes().map(|b| format!("{b:02x}")).collect::<String>())
}

/// Pasta temporária própria do teste (apagada no começo).
fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("avdp-consulta-teste-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn run(argv: &[&str]) -> Value {
    let argv: Vec<String> = argv.iter().map(|s| s.to_string()).collect();
    let a = Args::parse(&argv).unwrap();
    crate::commands::run(&a).unwrap_or_else(|e| json!({ "ok": false, "error": e.to_string() }))
}

fn long_paragraph() -> String {
    // 600 caracteres: 2 slides de até 420
    "Deus enviou o Seu profeta para o serviço da Noiva. ".repeat(12)
}

/// Banco do AVDP com 2 mensagens (uma com 130 §, com cópia antiga escondida), ACF e João 3.
fn avdp_db(dir: &Path) -> PathBuf {
    let path = dir.join("avdp.db");
    let mut c = crate::db::open(&path).unwrap();
    let tx = c.transaction().unwrap();
    let paras: Vec<(u32, String)> = (1..=130u32)
        .map(|n| (n, if n == 125 { long_paragraph() } else { format!("Parágrafo {n} da mensagem sobre o serviço a Deus.") }))
        .collect();
    let base = |source: &'static str, id: &str| NewVariant {
        source,
        source_id: id.into(),
        date_key: "1965-1127".into(),
        suffix: "B".into(),
        translation: "GO".into(),
        title: "Tentando Fazer Um Serviço A Deus Sem Ser A Vontade De Deus".into(),
        local: "Shreveport LA".into(),
        pdf_url: String::new(),
        audio_url: String::new(),
        page_url: String::new(),
        paragraphs: paras.clone(),
    };
    let site = messages::save_variant(&tx, &base("tdf", "WMB651127B")).unwrap();
    let old = messages::save_variant(&tx, &base("local", "65-1127B GO")).unwrap();
    tx.execute("UPDATE msg_variants SET superseded_by=?1 WHERE id=?2", [site, old]).unwrap();
    messages::save_variant(
        &tx,
        &NewVariant {
            source: "cbb",
            source_id: "777".into(),
            date_key: "1963-0318".into(),
            suffix: String::new(),
            translation: "CB".into(),
            title: "O Primeiro Selo".into(),
            local: "Jeffersonville IN".into(),
            pdf_url: String::new(),
            audio_url: String::new(),
            page_url: String::new(),
            paragraphs: vec![(1, "O cavalo branco saiu para vencer.".into()), (2, "Sétimo anjo e o mistério de Deus.".into())],
        },
    )
    .unwrap();
    tx.execute_batch("INSERT INTO bibles(id, name, abbrev) VALUES ('acf', 'Almeida Corrigida Fiel', 'ACF');").unwrap();
    for v in 1..=36 {
        tx.execute("INSERT INTO verses(bible_id, book, chapter, verse, text) VALUES ('acf', 43, 3, ?1, 'texto')", [v]).unwrap();
    }
    tx.execute_batch("INSERT INTO songs(title, lyrics) VALUES ('Hino', 'a'); INSERT INTO settings VALUES ('x', '1');").unwrap();
    tx.commit().unwrap();
    path
}

fn plugin_db(name: &str) -> (PathBuf, String) {
    let dir = temp_dir(name);
    let src = avdp_db(&dir);
    let to = dir.join("Plugin Ação").join("avdp-mensagens.db");
    let r = run(&["make-db", "--from", &hex(&src.display().to_string()), "--to", &hex(&to.display().to_string())]);
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(r["paragraphs"], json!(262)); // 130 do site + 130 da cópia escondida + 2
    (dir, hex(&to.display().to_string()))
}

#[test]
fn make_db_keeps_only_messages() {
    let (dir, db) = plugin_db("make");
    let path = dir.join("Plugin Ação").join("avdp-mensagens.db");
    let c = rusqlite::Connection::open(&path).unwrap();
    let names: Vec<String> = c.prepare("SELECT name FROM sqlite_master WHERE type='table'").unwrap().query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
    for gone in ["songs", "verses", "bibles", "settings", "playlists", "songs_fts", "verses_fts_vocab"] {
        assert!(!names.contains(&gone.to_string()), "{gone} ficou no banco");
    }
    for kept in ["msg_groups", "msg_variants", "msg_paragraphs", "msg_fts", "plugin_vocab", "plugin_bibles", "plugin_chapters", "plugin_meta"] {
        assert!(names.contains(&kept.to_string()), "{kept} sumiu");
    }
    let mode: String = c.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
    assert_eq!(mode, "delete");
    drop(c);
    assert!(!dir.join("Plugin Ação").join("avdp-mensagens.novo.db").exists());
    let info = run(&["info", "--db", &db]);
    assert_eq!(info["groups"], json!(2));
    assert_eq!(info["with_text"], json!(2));
    assert_eq!(info["meta"]["paragraphs"], json!("262"));
    // gerar de novo troca o banco (o anterior não está aberto)
    let again = run(&["make-db", "--from", &hex(&dir.join("avdp.db").display().to_string()), "--to", &db]);
    assert!(again.get("error").is_none(), "{again}");
}

#[test]
fn search_hides_old_copies_and_finds_codes() {
    let (_dir, db) = plugin_db("search");
    let r = run(&["search", "--db", &db, "--q", &hex("serviço Deus"), "--limit", "500"]);
    assert_eq!(r["total"], json!(130), "{r}");
    assert!(r["hits"].as_array().unwrap().iter().all(|h| h["source"] == "tdf"));
    let r = run(&["search", "--db", &db, "--q", &hex("\"mistério de Deus\""), "--mode", "exact"]);
    assert_eq!(r["total"], json!(1));
    assert_eq!(r["hits"][0]["code"], json!("63-0318"));
    assert!(r["hits"][0]["marked"].as_str().unwrap().contains('⟦'));
    let r = run(&["search", "--db", &db, "--q", "65-1127B"]);
    assert_eq!(r["direct"][0]["code"], json!("65-1127B"));
    // variações e aproximada (vocabulário pronto do plugin)
    let r = run(&["search", "--db", &db, "--q", &hex("cavalos"), "--variants"]);
    assert_eq!(r["total"], json!(1), "{r}");
    let r = run(&["search", "--db", &db, "--q", &hex("misterio"), "--fuzzy", "--whole-word"]);
    assert_eq!(r["total"], json!(1), "{r}");
    let r = run(&["search", "--db", &db, "--q", &hex("serviço"), "--by-message"]);
    assert_eq!(r["hits"][0]["hits"], json!(130));
    let r = run(&["search", "--db", &db]);
    assert_eq!(r["ok"], json!(false));
}

#[test]
fn group_by_code_and_title() {
    let (_dir, db) = plugin_db("group");
    let r = run(&["group", "--db", &db, "--code", "65-1127B"]);
    let gs = r["groups"].as_array().unwrap();
    assert_eq!(gs.len(), 1);
    let vs = gs[0]["variants"].as_array().unwrap();
    assert_eq!(vs.len(), 1, "a cópia escondida não aparece");
    assert_eq!(vs[0]["source_id"], json!("WMB651127B"));
    assert_eq!(vs[0]["para_count"], json!(130));
    // sem a letra: o dia todo
    assert_eq!(run(&["group", "--db", &db, "--code", "65-1127"])["groups"].as_array().unwrap().len(), 1);
    let r = run(&["group", "--db", &db, "--filter", &hex("primeiro selo")]);
    assert_eq!(r["groups"][0]["code"], json!("63-0318"));
}

#[test]
fn paragraphs_whole_message_from_the_paragraph() {
    let (_dir, db) = plugin_db("paras");
    // pela fonte da cópia escondida: vai para a revisão do site
    let r = run(&["paragraphs", "--db", &db, "--src", "local", "--src-id", &hex("65-1127B GO"), "--num", "125"]);
    assert_eq!(r["source"], json!("tdf"), "{r}");
    assert_eq!(r["code"], json!("65-1127B"));
    let slides = r["slides"].as_array().unwrap();
    // 130 § e o § 125 (564 caracteres) dividido em 2
    assert_eq!(slides.len(), 131);
    let start = r["start_slide"].as_u64().unwrap() as usize;
    assert_eq!(start, 124);
    assert_eq!(slides[start]["num"], json!(125));
    assert_eq!(slides[start]["parts"], json!(2));
    assert_eq!(slides[start + 2]["num"], json!(126));
    // sem dividir
    let r = run(&["paragraphs", "--db", &db, "--variant", &r["variant"].to_string(), "--chars", "0"]);
    assert_eq!(r["slides"].as_array().unwrap().len(), 130);
    assert_eq!(r["start_slide"], json!(0));
    // pelo grupo (tradução escolhida) e § que não existe: o seguinte
    let gid = r["group"].to_string();
    let r = run(&["paragraphs", "--db", &db, "--group", &gid, "--num", "999"]);
    assert_eq!(r["start_num"], json!(1));
    let r = run(&["paragraphs", "--db", &db, "--variant", "9999"]);
    assert_eq!(r["ok"], json!(false));
}

#[test]
fn fila_becomes_holyrics_items() {
    let (dir, db) = plugin_db("fila");
    let folder = dir.join("Filas Ação");
    std::fs::create_dir_all(&folder).unwrap();
    let file = folder.join("Culto de domingo.avdpfila");
    let fila = json!({
        "kind": "avdp-fila", "version": 1, "id": "PC#3#1", "name": "DOM, 18/10/2026", "from": "PC-ISAAC", "exported_at": 1,
        "items": [
            { "kind": "song", "label": "Hino", "ref": { "id": 9 }, "song": { "title": "Castelo Forte", "artist": "", "author": "Lutero", "lyrics": "Castelo forte\né nosso Deus\n\nRefrão:\nAmém", "paragraph_order": "1,2,1" } },
            { "kind": "verse", "label": "João 3 — ACF", "ref": { "book": 43, "chapter": 3, "bible": "acf" } },
            { "kind": "verse", "label": "João 3:16 — ACF", "ref": { "book": 43, "chapter": 3, "verse": 16, "bible": "acf" } },
            { "kind": "verse", "label": "Gênesis 1:1-3 — BPM", "ref": { "book": 1, "chapter": 1, "verses": [3, 1, 2] } },
            { "kind": "message", "label": "65-1127B — §125", "ref": { "groupId": 1 }, "message": {
                "code": "65-1127B", "date_key": "1965-1127", "suffix": "B", "source": "tdf", "source_id": "WMB651127B", "translation": "GO",
                "title": "Tentando Fazer Um Serviço A Deus", "num": 125, "paragraphs": [[124, "Antes."], [125, long_paragraph()], [126, "Depois."]] } },
            { "kind": "message", "label": "Outra", "ref": {}, "message": { "code": "99-0101", "source": "local", "source_id": "nao-existe", "title": "Sem Banco", "paragraphs": [[0, "Introdução."], [1, "Um."]] } },
            { "kind": "text", "label": "Avisos", "ref": { "id": 2 }, "text": { "title": "Avisos", "body": "Primeiro aviso\n\nSegundo aviso" } },
            { "kind": "media", "label": "video.mp4", "ref": { "path": "C:/x/video.mp4" } }
        ]
    });
    std::fs::write(&file, serde_json::to_string(&fila).unwrap()).unwrap();
    let r = run(&["fila", "--db", &db, "--file", &hex(&file.display().to_string())]);
    assert_eq!(r["name"], json!("DOM, 18/10/2026"), "{r}");
    let it = r["items"].as_array().unwrap();
    assert_eq!(it.len(), 8);
    assert_eq!(it[0]["text"], json!("Castelo forte\né nosso Deus\n\nAmém\n\nCastelo forte\né nosso Deus"));
    assert_eq!(it[0]["artist"], json!("Lutero"));
    assert_eq!(it[1]["ids"].as_array().unwrap().len(), 36);
    assert_eq!(it[1]["ids"][0], json!("43003001"));
    assert_eq!(it[1]["bible_abbrev"], json!("ACF"));
    assert_eq!(it[2]["ids"], json!(["43003016"]));
    assert_eq!(it[3]["ids"], json!(["01001001", "01001002", "01001003"]));
    assert_eq!(it[3]["bible_abbrev"], json!("BPM"));
    assert_eq!(it[4]["name"], json!("65-1127B Tentando Fazer Um Serviço A Deus — §125"));
    assert_eq!(it[4]["text"].as_str().unwrap().split("\n\n").count(), 3, "§125 em 2 slides + §126");
    assert_eq!(it[4]["found"]["seq"].as_i64().is_some(), true);
    assert!(it[5]["found"].is_null());
    assert_eq!(it[5]["text"], json!("Introdução.\n\nUm."));
    assert_eq!(it[5]["name"], json!("99-0101 Sem Banco"));
    assert_eq!(it[6]["text"], json!("Primeiro aviso\n\nSegundo aviso"));
    assert_eq!(it[7]["kind"], json!("media"));

    // lista de filas na pasta pedida
    let l = run(&["filas", "--dir", &hex(&folder.display().to_string())]);
    let files = l["files"].as_array().unwrap();
    assert!(files.iter().any(|f| f["name"] == "DOM, 18/10/2026" && f["items"] == 8), "{l}");

    // sem o banco a fila ainda sai (mensagem como texto, capítulo inteiro sem versículos)
    let r = run(&["fila", "--db", &hex(&dir.join("nao-existe.db").display().to_string()), "--file", &hex(&file.display().to_string())]);
    assert!(r["db_error"].is_string());
    assert_eq!(r["items"][2]["ids"], json!(["43003016"]));
    assert!(r["items"][4]["found"].is_null());

    // arquivo que não é fila
    let other = folder.join("x.avdpfila");
    std::fs::write(&other, "{\"kind\":\"outra\"}").unwrap();
    assert_eq!(run(&["fila", "--file", &hex(&other.display().to_string())])["ok"], json!(false));
}

#[test]
fn make_db_leaves_no_side_files_next_to_the_avdp_db() {
    // banco do AVDP em WAL (como o real), fechado, numa pasta com espaço e acento
    let dir = temp_dir("wal").join("Dados do AVDP Ação");
    std::fs::create_dir_all(&dir).unwrap();
    let src = avdp_db(&dir);
    let side = |ext: &str| PathBuf::from(format!("{}{ext}", src.display()));
    assert!(!side("-wal").exists() && !side("-shm").exists(), "o AVDP fechado não deixa -wal");
    let to = dir.join("plugin.db");
    let r = run(&["make-db", "--from", &hex(&src.display().to_string()), "--to", &hex(&to.display().to_string())]);
    assert!(r.get("error").is_none(), "{r}");
    assert!(!side("-wal").exists() && !side("-shm").exists(), "make-db criou arquivos ao lado do banco do AVDP");
    // consultas no banco do AVDP direto (--db) também não deixam nada
    let r = run(&["search", "--db", &hex(&src.display().to_string()), "--q", "Deus"]);
    assert!(r["total"].as_i64().unwrap() > 0, "{r}");
    assert!(!side("-wal").exists() && !side("-shm").exists());
    // com o AVDP aberto (conexão gravando em WAL) a leitura continua funcionando
    let open = crate::db::open(&src).unwrap();
    open.execute("UPDATE msg_groups SET title=title", []).unwrap();
    assert!(side("-wal").exists());
    let r = run(&["group", "--db", &hex(&src.display().to_string()), "--code", "65-1127B"]);
    assert_eq!(r["groups"].as_array().unwrap().len(), 1, "{r}");
    drop(open);
}

#[test]
fn abrir_acha_o_avdp_instalado_ou_o_caminho_dado() {
    use crate::commands::avdp_exe;
    let d = temp_dir("abrir");
    // sem instalação: erro legível com a pasta esperada
    let e = avdp_exe(None, Some(d.clone())).unwrap_err().to_string();
    assert!(e.contains("não está instalado"), "{e}");
    // só o AVDP Busca instalado (%LOCALAPPDATA%\AVDP Busca): abre ele com --holyrics
    let exe = d.join("AVDP Busca").join("avdp-busca.exe");
    std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
    std::fs::write(&exe, b"").unwrap();
    assert_eq!(avdp_exe(None, Some(d.clone())).unwrap(), exe);
    // com o AVDP Busca Plugin instalado, ele vem primeiro
    let plugin = d.join("AVDP Busca Plugin").join("avdp-busca-plugin.exe");
    std::fs::create_dir_all(plugin.parent().unwrap()).unwrap();
    std::fs::write(&plugin, b"").unwrap();
    assert_eq!(avdp_exe(None, Some(d.clone())).unwrap(), plugin);
    // caminho das configurações do módulo (com aspas) vence; inexistente é erro
    assert_eq!(avdp_exe(Some(format!("\"{}\"", exe.display())), None).unwrap(), exe);
    assert!(avdp_exe(Some(d.join("nada.exe").display().to_string()), Some(d.clone())).is_err());
    // o comando com caminho errado não abre nada e responde erro
    let v = run(&["abrir", "--exe", &hex(&d.join("nada.exe").display().to_string())]);
    assert_eq!(v["ok"], false);
}

#[test]
fn visual_copia_fundos_e_monta_o_tema_do_holyrics() {
    let d = temp_dir("visual");
    let data = d.join("br.avdp.busca");
    std::fs::create_dir_all(data.join("fundos")).unwrap();
    std::fs::write(data.join("fundos").join("fundo HL.png"), b"png").unwrap();
    std::fs::write(data.join("fundos").join("parede.jpg"), b"jpg").unwrap();
    let c = rusqlite::Connection::open(data.join("avdp.db")).unwrap();
    c.execute_batch("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT); CREATE TABLE themes(id INTEGER PRIMARY KEY, name TEXT, data TEXT);").unwrap();
    // caminhos de outro PC: acha pelo nome em fundos
    let ui = json!({ "themeByKind": { "song": 2 }, "wallpaperImage": r"C:\Users\Outro\AppData\Roaming\br.avdp.busca\fundos\parede.jpg" });
    c.execute("INSERT INTO settings VALUES('ui', ?1)", [ui.to_string()]).unwrap();
    c.execute("INSERT INTO themes VALUES(1, 'Madeira', ?1)", [json!({ "bg": { "kind": "gradient", "gradient": "radial-gradient(#3a2a1c 0%, #140d08 75%)" } }).to_string()]).unwrap();
    let t = json!({ "bg": { "kind": "image", "image": r"C:\Users\Outro\fundos\fundo HL.png", "dim": 0 }, "font": "Montserrat", "size": 14, "color": "#ffffff", "bold": true,
        "align": "center", "valign": "middle", "lineHeight": 1.3, "shadow": true, "outline": 0, "padding": 6 });
    c.execute("INSERT INTO themes VALUES(2, 'Clássico escuro', ?1)", [t.to_string()]).unwrap();
    drop(c);
    let lib = d.join("image");
    let v = run(&["visual", "--avdp-dir", &hex(&data.display().to_string()), "--lib", &hex(&lib.display().to_string())]);
    assert_eq!(v["wallpaper"], "AVDP/parede.jpg", "{v}");
    let th = &v["theme"];
    assert_eq!(th["name"], "AVDP - Clássico escuro");
    assert_eq!(th["background"], json!({ "type": "image_file", "id": "AVDP/fundo HL.png", "adjust_type": "fill", "opacity": 100 }));
    assert_eq!((th["font"]["name"].as_str(), th["font"]["size"].as_f64(), th["font"]["color"].as_str()), (Some("Montserrat"), Some(14.0), Some("FFFFFF")));
    assert_eq!(th["font"]["line_spacing"], 0.3);
    assert_eq!(th["align"]["margin"]["left"], 4.1);
    assert!(lib.join("AVDP").join("fundo HL.png").is_file() && lib.join("AVDP").join("parede.jpg").is_file());
    // sem tema escolhido: o primeiro; gradiente vira a primeira cor
    let c = rusqlite::Connection::open(data.join("avdp.db")).unwrap();
    c.execute("UPDATE settings SET value=?1", [json!({}).to_string()]).unwrap();
    drop(c);
    let v = run(&["visual", "--avdp-dir", &hex(&data.display().to_string()), "--lib", &hex(&lib.display().to_string())]);
    assert_eq!(v["theme"]["background"], json!({ "type": "color", "id": "3A2A1C" }), "{v}");
    assert!(v["wallpaper"].is_null());
}
