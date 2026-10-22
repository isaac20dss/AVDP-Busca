# AVDP Busca

Passador de letras no estilo do Holyrics, com Bíblia e Mensagens.

## Rodar

```bash
cd app
npm install
npx tauri dev
```

Instalador (gera `app/src-tauri/target/release/bundle/nsis/AVDP Busca_x.y.z_x64-setup.exe`):

```bash
cd app
npx tauri build
```

Versão 1.0.0. Pacote para outro computador (instalador + banco + `INSTALAR.cmd`): `Levar para outro PC\AVDP-Busca-1.0.0-instalar-com-banco.zip`; o código-fonte vai em `AVDP-Busca-1.0.0-codigo-fonte.zip`, na mesma pasta.

## Onde ficam os dados

`%APPDATA%\br.avdp.busca\avdp.db` (SQLite): músicas, textos, Bíblias, mensagens, temas, listas, configurações.
Imagens de fundo dos temas: `%APPDATA%\br.avdp.busca\fundos\`.

## Fontes de dados

| Fonte | Como entra |
|---|---|
| Mensagens locais (`database-mensagens\mensagens.db`) | Configurações → Mensagens → Importar (ou no primeiro uso) |
| Busca CBB | Configurações → Mensagens → Sincronizar (API pública do site) |
| Tabernáculo da Fé (busca.tabernaculodafe.org.br) | Configurações → Mensagens → Tabernáculo da Fé → Sincronizar (API pública do Busca). Traz as traduções GO e GVD na revisão mais nova; onde o banco local ou o CBB têm o mesmo texto, a cópia antiga fica escondida (não é apagada; aparece se filtrar pela fonte). Da segunda vez só baixa o que for novo ou revisado. |
| The Table | Só o modelo de busca (conteúdo protegido). Trechos copiados podem ser colados em Textos → Importar. |
| Bíblias livres | Configurações → Bíblias → Baixar (eBible.org) ou importar XML/JSON/CSV/MyBible/EasySlides |
| ACF, NVI, KJA | Importadas dos arquivos do Isaac em `BÍBLIA\` (ACF é a principal) |
| Bíblias do Holyrics | Ficam no Holyrics (licenciadas, cifradas). Modo **Projetar pelo Holyrics** e botão **Holyrics** mandam o versículo pela API oficial (precisa do token em Configurações → Holyrics). |
| Músicas | Importar: PDF, Word, PowerPoint, ODT, HTML, TXT, EasySlides/OpenLyrics XML, JSON, texto colado |

## Busca

Modos: **Todas** as palavras, **Frase exata**, **Próximas** (até N palavras), **Qualquer**.
Opções: palavra inteira, variações (amor/amores/amar), aproximada (erro de digitação).
Sintaxe: `"frase"`, `"anjo luz"~5` (perto), `-excluir`, `OU`, `XOR` (só um dos dois), parênteses `(graça OU fé) lei`, `começo*`, curinga no meio (`pro?eta`, `ser*ente`), `parecida~`, peso `graça^3`, `titulo:graça`. Código de data: `65-1127B`, `1958-0309`. Na pesquisa de mensagens, sugestões aparecem ao digitar (frases como "sete selos", palavras e títulos; setas + Enter).

## Exportar para o Holyrics

Botão de envio na lista de reprodução: manda a lista inteira para a lista de reprodução aberta no Holyrics (músicas achadas pelo título viram a música do Holyrics; versículos vão com a versão; mensagens e textos vão como texto; mídia fica de fora). Precisa do Holyrics aberto com o API Server ligado e o token preenchido em Configurações → Holyrics, com as permissões `SearchLyrics` e `AddToPlaylist`.

## Levar a fila para outro computador

Na lista de reprodução: **Exportar esta fila** (seta para cima) grava um arquivo `.avdpfila`, por exemplo numa pasta do Google Drive; no outro PC, **Importar fila** (seta para baixo). A lista entra como nova; importar de novo o arquivo da mesma lista atualiza essa lista. Bíblia vai pela referência; mensagem vai pelo código da data e pelo §, e, se o outro PC não tiver a mensagem, ela é baixada do Tabernáculo da Fé ou gravada a partir do arquivo (funciona sem internet). Música e texto vão inteiros.

## Plugin no Holyrics (AVDP Mensagens)

Módulo do Holyrics com as Mensagens e a fila, sem precisar do AVDP aberto: pesquisar como no AVDP, projetar a mensagem inteira a partir do §, adicionar à lista de reprodução e importar a `.avdpfila`. Funciona no Holyrics grátis (testado no 2.30.0). Pacote e passo a passo: `Plugin Holyrics\AVDP-Mensagens-Holyrics-1.0.0.zip` e `Plugin Holyrics\LEIA-ME - PASSO A PASSO.txt`. Banco próprio em `C:\AVDP Holyrics\avdp-mensagens.db` (atualizar com `ATUALIZAR-BANCO-DO-PLUGIN.cmd` depois de baixar mensagens novas no AVDP). Código: `app/avdp-consulta/` (programa Rust que reaproveita a busca do app) e `app/avdp-consulta/modulo/avdp-mensagens.js`.

```bash
cd app/avdp-consulta
cargo test
cargo build --release
```

## Bíblia e palco

- Trecho: `1co 13:4-7` + Enter projeta o trecho (um versículo por slide ou todos juntos: Configurações → Projeção → Bíblia). No centro, Ctrl+clique soma versículos e Shift+clique escolhe um trecho.
- ★ guarda nos favoritos; as abas Favoritos e Histórico ficam no painel da Bíblia. "Só ref." projeta só a referência.
- Ctrl+B troca entre as versões marcadas em Configurações → Bíblias (padrão: ACF, KJA, NVI); Ctrl+Alt+1/2/3 vai direto.
- Tela de palco (retorno) para quem está na frente: Ctrl+Shift+O ou Configurações → Projeção.

## Testes

```bash
cd app/src-tauri
cargo test --lib
```

27 testes (mais 1 que usa a internet: `cargo test --lib -- --ignored tdf_download_and_import`). Testes no app real (sem projetar na TV): `node tools/cdp.mjs tools/flow3.mjs <pasta>` (42 verificações), `tools/flow4.mjs` (29, inclui a exportação contra um Holyrics simulado), `tools/flow5.mjs` (10, fonte Tabernáculo da Fé), `tools/flow6.mjs` (9, fila entre PCs) e `tools/flow2.mjs`, com o app aberto por `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npx tauri dev`. App de produção: abrir `app/src-tauri/target/release/avdp-busca.exe` com a mesma variável e rodar `node tools/release-smoke.mjs <pasta>`. **Testes abertos pelo Claude: sempre com `AVDP_DATA_DIR=<pasta com uma cópia do banco>`** (o Claude empacotado desvia o `%APPDATA%`; ver HANDOFF, seção 6).

Pesquisa e decisões: `docs/PESQUISA.md`, `docs/DESIGN.md`. Melhorias propostas: `docs/MELHORIAS.md`. Plugin no Holyrics: `docs/PLANO-PLUGIN-HOLYRICS.md` (seção 8 = como ficou). Estado completo: `HANDOFF.md`.
