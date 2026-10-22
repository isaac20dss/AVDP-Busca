# Prompt de retomada (2026-10-22) — Mac + git + GitHub

Cole o bloco abaixo numa sessão nova (depois do `/clear`), com a pasta `C:\Users\Isaac\Documents\Claude\AVDP\AVDP Busca` aberta.

---

```
Retomar o AVDP Busca (versão 1.3.0). Leia primeiro, inteiro: `HANDOFF.md` (estado, regras, armadilhas desta máquina) e a memória do projeto. Responda em caveman ultra.

Tarefas, nesta ordem:

1. GIT + GITHUB
   - `git init` na pasta `AVDP Busca` (raiz do projeto; o app fica em `app/`). Branch `main`.
   - `.gitignore` ANTES do primeiro commit. Fora do repositório:
     `app/node_modules/`, `app/dist/`, `app/x/`, `app/src-tauri/target*/` (target, target-1.1, -1.2, -1.3),
     `app/src-tauri/icons-antigo/`? (decidir: pequeno, pode entrar), `app/avdp-consulta/target/`,
     `Levar para outro PC/` (zips de 130–180 MB com o banco), `Plugin Holyrics/*.zip` e `Plugin Holyrics/pacote/`
     (banco de 222 MB), `database-mensagens/` (banco local de mensagens),
     `*.db`, `*.db-wal`, `*.db-shm`, `*.avdpfila`, arquivos > 50 MB (o banco vai pelo Releases, abaixo). A pasta `BÍBLIA/` NÃO entra no .gitignore.
   - **Decisão do Isaac (2026-10-22): o banco e as Bíblias (`BÍBLIA/`: ACF, NVI, KJA) sobem junto, ou pelo menos
     instaladores Windows e Mac já com o banco.** Como NVI/ACF/KJA e os textos das mensagens são traduções
     protegidas por direito autoral, isso só no repositório **PRIVADO**. Confirmar com o Isaac que está privado
     antes do push; se ele quiser público, o conteúdo licenciado fica fora e vai só o código.
   - Como subir o que é grande (o GitHub recusa arquivo > 100 MB no git):
     * `BÍBLIA/` (arquivos pequenos) → no git normal (repo privado);
     * banco (`avdp.db` 381 MB) e pacotes "instalar com banco" → **GitHub Releases** (anexo de até 2 GB cada):
       release `v1.3.0` com `AVDP-Busca-1.3.0-instalar-com-banco.zip` (Windows, 172 MB, está no Drive
       `G:\.shortcut-targets-by-id\14a_5XfpD6VjggtzDGAzJiUNTyjCn1xEU\Meu Drive\11-Inteligência Artificial\11.05 - Isaac\AVDP Busca 1.3.0\`) e, depois do item 2, o pacote do Mac
       (`.dmg` + banco + `instalar.command`). `gh release create v1.3.0 <arquivos> --repo isaac20dss/AVDP-Busca`.
     * alternativa: Git LFS para `banco/avdp.db` (cota grátis do LFS é 1 GB de armazenamento/mês de banda — o
       Releases é melhor).
   - Conferir antes do commit: `git status`, maior arquivo (`git ls-files | xargs du -h | sort -h | tail`), e
     **nenhum segredo**: procurar `api_key`, `token`, chaves do Holyrics (não estão em arquivo, mas confira).
   - Remoto: `https://github.com/isaac20dss/AVDP-Busca.git`. Commit com a atribuição do sistema.
     Push com `gh` (ou git) — se pedir login, o Isaac faz.

2. COMPATÍVEL COM MAC (macOS, Apple Silicon e Intel)
   Tauri v2 já roda no Mac; o trabalho é tirar o que é só Windows e gerar o `.dmg`. Levantar e ajustar:
   - `src-tauri/src/lib.rs`: `computer_name()` usa `COMPUTERNAME` (no Mac: `scutil --get ComputerName` ou
     `hostname`); `AVDP_DATA_DIR`; pasta de dados (`app_data_dir` → `~/Library/Application Support/br.avdp.busca`).
   - `db.rs::relocate_data_dir`: regex só entende caminho Windows (`C:\\…\\br.avdp.busca\\`); aceitar também
     `/Users/…/br.avdp.busca/` e trocar barra por barra do sistema (banco vindo do Windows → Mac).
   - `msg_default_local_path`, EasySlides (`bible_scan_easyslides`), Holyrics (`C:\Holyrics\…`): caminhos Windows.
   - Janela de projeção/palco em tela cheia por monitor (`open_output`): testar no Mac (fullscreen/Spaces).
   - Atalhos: Ctrl → Cmd no Mac (`lib/hotkeys.ts`, `comboFromEvent`); F8/F9/F10 no Mac pedem Fn.
   - Fontes: "Segoe UI" (só Windows) nos fallbacks.
   - Testes: `tools/*.mjs` usam CDP do WebView2 (só Windows). No Mac o WebView é WKWebView: sem CDP; anotar
     que os testes ponta a ponta continuam no Windows.
   - Plugin do Holyrics (`app/avdp-consulta`, `.cmd`) é só Windows: deixar fora do build do Mac.
   - Build do Mac só num Mac (`npx tauri build` → `.dmg`) ou GitHub Actions (`tauri-apps/tauri-action`,
     runner `macos-latest`, alvos `aarch64-apple-darwin` e `x86_64-apple-darwin`). Propor um workflow
     `.github/workflows/build.yml` que gera Windows + Mac nos releases. Sem certificado Apple, o app abre com
     "desenvolvedor não identificado" (botão direito → Abrir) — avisar.
   - Pacote "com banco" no Mac: equivalente do `INSTALAR.cmd` em shell (`instalar.command`) que copia o banco
     para `~/Library/Application Support/br.avdp.busca/` (com backup) — ou botão "Importar banco" no app.
   - Depois das mudanças: `cargo test --lib` (app) e `cargo test` (avdp-consulta), `npx tsc -p tsconfig.app.json
     --noEmit`, e os fluxos `tools/flow3..flow10.mjs` no Windows com `AVDP_DATA_DIR` (regras no HANDOFF, seção 6).
   - Atualizar `HANDOFF.md` e a memória.

Regras que continuam valendo: pasta pessoal (nada para o cofre Obsidian); testes só com `AVDP_DATA_DIR` numa
cópia do banco e `WEBVIEW2_USER_DATA_FOLDER` próprio; nunca projetar na TV nos testes; não fechar o AVDP que o
Isaac deixou aberto; chaves/token do Holyrics nunca em arquivo.
```
