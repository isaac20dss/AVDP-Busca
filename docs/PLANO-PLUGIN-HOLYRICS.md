# Plano — Mensagens e fila como módulo do Holyrics

Data: 2026-10-16. Status em 2026-10-18: **feito e testado no Holyrics 2.30.0 grátis** pela opção B (oitava leva do HANDOFF). O que a implementação e o teste mudaram neste plano está na seção 8; as seções 1–7 ficam como foram escritas.

## 1. Como o Holyrics aceita extensões (fontes primárias)

No Holyrics, plugin se chama **módulo**: um arquivo JavaScript que roda dentro do programa, com a biblioteca **JSLib** (`h.`) e o objeto `module`.

| Fato | Fonte |
|---|---|
| JavaScript ECMAScript 5.1; desde a 2.23.0, arrow functions são convertidas sozinhas. | [holyrics/jslib README](https://github.com/holyrics/jslib) |
| Módulo = arquivo `.js` com funções de topo: `info()`, `settings(module)`, `actions(module)`, `publicActions(module)`, `triggers(module)`, `loops(module)`, `startup(module)`, `shutdown(module)`, `contextActions`, `handleItemAction`, `systemVariables`, `listCellRendererBadges` e outras. | [JSCommunity/src/modules/README.md](https://github.com/holyrics/JSCommunity/blob/main/src/modules/README.md) |
| `info()` devolve `id`, `name`, `description`, `allowed_requests`, `min_version`, `max_version`, e (2.24+) `i18n`, `permissions`, `os_required`, `available_in_main_window`, `available_in_bible_window`. | idem + [example.js](https://github.com/holyrics/JSCommunity/blob/main/src/modules/example/example.js) |
| `actions()` vira botões no painel do módulo (abaixo da barra de favoritos), com submenu e `popup_menu` (botão direito). `publicActions()` pode ser chamada por gatilho, script ou **item da lista**: `available_for` é **texto separado por vírgula** (`ui`, `trigger`, `jslib_call`, `jslib_open`, `add_to_playlist`) e as entradas vão no campo **`input`** (lista de InputParam). | modules/README.md |
| Interface: botões do painel e diálogos `h.input`, `h.inputV2` (2.26+), `h.settings`, `h.itemChooser`, `h.confirm`, `h.notification`. `h.openWindow` só abre janelas do próprio programa. **Não há painel HTML.** | jslib README |
| Guardar dados: `module.store/restore` (disco, **entra na sincronização em nuvem**), `module.setGlobal/getGlobal` (memória), `module.device` (só neste PC). `h.readFileAsText` lê só arquivos **da biblioteca do Holyrics**, até 16 MB. `h.db` (2.28) só acessa dados do próprio Holyrics (músicas, textos, versões da Bíblia…). **Não há SQLite genérico.** | jslib README; modules/README.md |
| Rede: **`module.apiRequest(url, raw)`** (liberado por `info().allowed_requests`, lista fixa no código); `h.apiRequest` depende de liberação no menu de configurações. Resposta vem como texto (`JSON.parse`) ou `null` (erro em `getApiRequestLastError()`); tempo limite padrão 5000 ms. | jslib README; modules/README.md |
| Programas externos: **`module.executeCmdAndWait(arquivo, cli, timeout)`** e `module.process(...)` (2.24+) rodam um `.exe` posto na biblioteca do Holyrics, com a permissão `{type:'advanced', key:'allowed_files'}`; a saída volta pelo stdout. | modules/README.md; jslib README |
| Projetar: `h.hly('ShowQuickPresentation', { text \| slides, theme, custom_theme, automatic, initial_index })` (`slides` e `initial_index` 2.23+; texto lido como texto com estilo, desde 2.19); navegação nativa `ActionNextQuickPresentation` / `ActionPreviousQuickPresentation` / `GetCurrentQuickPresentation` (2.24+); `slides[].translations` põe uma segunda tradução no slide. `h.hly('ShowVerse', { id \| ids \| references, version })`, até 100 versículos. | jslib README |
| Lista: `h.hly('AddToPlaylist', { items, index, ignore_duplicates })` (vai para a lista **que estiver selecionada**; escolher a lista por `event_id` exige Plan) com itens `plain_text` (`name`, `text`, `theme` = ID em texto, `background`; 2.27+), `verse`, `text` (`id`), `module_action` (`id` do módulo no programa, `module_action_id`, `inputs`). | jslib README (AddItem*) |
| Gatilhos: `when` = `displaying` \| `closing` \| `change` \| `event`, `item`, `filter` (2.24+). | modules/README.md |
| Instalação pela janela **Módulos**. **Modo desenvolvimento** (lê o código de uma pasta) desde 2.29, **exige Holyrics Plan**. `CreateText`/`CreateItem` (criar texto na biblioteca) também **exige Plan** e permissão. Se módulos comuns rodam na versão grátis: **não encontrado** na documentação. | modules/README.md; jslib README |

O código do próprio Holyrics (`lib\pack*.dat`) é cifrado e não foi aberto: a documentação oficial basta.

## 2. Limites que decidem o desenho

1. **O banco de mensagens não cabe no módulo.** `avdp.db` tem ~223 MB (SQLite FTS5). O módulo não abre SQLite, e `readFileAsText` só lê até 16 MB da biblioteca do Holyrics. A busca estilo The Table precisa ficar fora, no AVDP.
2. **Sem painel HTML.** A busca dentro do Holyrics vira: digitar → escolher numa lista → escolher a ação (ou menu de botão direito). Mais pobre que a tela de Mensagens do AVDP (leitor, comparar traduções, procurar na mensagem).
3. **Importar as mensagens como Textos do Holyrics** (1.740 textos, ~120 slides cada) incharia a biblioteca, perderia a busca e exige Plan (`CreateText`). Não recomendado.

## 3. Arquitetura: duas opções

### Opção A — AVDP como servidor local + módulo fino
```
Holyrics (módulo)  --module.apiRequest-->  AVDP Busca (API em 127.0.0.1:8095, porta fixa, token)  -->  avdp.db
```
- Exige o AVDP aberto (pode ficar minimizado). Resposta rápida; serve também a fila do AVDP.

### Opção B — programa de consulta chamado pelo módulo (sem servidor)
```
Holyrics (módulo)  --module.executeCmdAndWait-->  avdp-consulta.exe (na biblioteca do Holyrics)  -->  avdp.db (só leitura)
```
- Um executável pequeno (Rust, mesmo código de busca do AVDP) recebe a pesquisa pela linha de comando e devolve JSON. **Funciona com o AVDP fechado**, sem porta nem token. Precisa da permissão `allowed_files`; o antivírus pode reclamar de `.exe` novo.

**Recomendação:** B para pesquisar e projetar (menos coisas para dar errado no culto); A só se quiser a fila do AVDP sincronizada ao vivo.

### 3.1 Lado AVDP (Rust)
- Opção A: API só em `127.0.0.1:8095`, token, liga/desliga em Configurações. Rotas: `/api/msg/search`, `/api/msg/paragraphs`, `/api/msg/group?code=`, `/api/fila`.
- Opção B: `avdp-consulta.exe search "texto" --modo exact --anos 1963-1965` / `paragraphs --variant N` / `group --code 65-1127B`, saída JSON em UTF-8.

### 3.2 Lado Holyrics (módulo `avdp-mensagens.js`, arquivo único para colar na janela Módulos)
- `info()`: `id: 'avdp_mensagens'`, `min_version: '2.30.0'` (a versão testada; no mínimo 2.26 por causa do `inputV2`), `os_required: 'windows'`, `available_in_main_window: true`, `allowed_requests: ['http://127.0.0.1:8095/']` (opção A) ou `permissions: [{ type: 'advanced', key: 'allowed_files' }]` (opção B).
- `settings()`: tema para mensagens, máximo de caracteres por slide, mostrar rodapé (código + §). Token (opção A) guardado em `module.device`, não em `store` (não ir para a nuvem).
- `actions()`:
  1. **Pesquisar mensagem** → `h.inputV2` (texto, modo, anos) → consulta → `h.itemChooser` ("65-1127B Título — §12: trecho…") → **Projetar** ou **Adicionar à lista** (via `popup_menu` ou segundo diálogo).
  2. **Abrir por data** (65-1127B) → tradução → parágrafo.
  3. **Enviar fila do AVDP** (só opção A).
- Projetar = `ShowQuickPresentation` com **a mensagem inteira** em slides (parágrafo longo dividido por tamanho, não só por §), `initial_index` no § escolhido; seguinte/anterior pela navegação nativa (`ActionNextQuickPresentation`). Escapar o texto (é lido como texto com estilo). Tema: `ShowQuickPresentation` usa `theme: {name}`; `plain_text` usa o ID em texto.
- `publicActions()`: `show_paragraph` com `available_for: 'ui,add_to_playlist,trigger,jslib_call'` e `input: [{id:'group'}, {id:'variant'}, {id:'seq'}]`.
- Tratar resposta `null` e erro; usar `apiRequestAsync` ou `h.setTimeout` quando a ação vier da lista (o tempo de execução de `ModuleAction` é curto: 500 ms por padrão).

### 3.3 Fila (lista de reprodução)
- Item de mensagem como **`module_action`** (`id` = `module.id` lido em tempo de execução, conferir com `GetModules`; `module_action_id: 'show_paragraph'`; `inputs`): busca o texto na hora.
- Alternativa offline: **`plain_text`** com o texto copiado.
- "Enviar fila do AVDP": mensagem → `module_action` ou `plain_text`; versículo → item `verse` com a versão do Holyrics (conferir com `GetBibleVersionsV2` se ACF/NVI/KJA existem lá); música → procurar pelo título com `h.db.songs`.
- `AddToPlaylist` cai na lista que estiver aberta no Holyrics: avisar o operador antes.

## 4. Etapas e custo

| # | Etapa | Custo |
|---|---|---|
| 1 | Opção B: `avdp-consulta.exe` (reaproveita `search.rs`/`messages.rs`) + testes. Ou opção A: API local | médio |
| 2 | Módulo mínimo: `info`, `settings`, "Pesquisar" → `ShowQuickPresentation` com a mensagem inteira | baixo |
| 3 | `publicActions` `show_paragraph` + "Adicionar à lista" (`module_action` e `plain_text`) | baixo |
| 4 | "Abrir por data"; dividir parágrafo longo | baixo |
| 5 | (Opção A) "Enviar fila do AVDP" | médio |
| 6 | Entrega: um `.js` único para colar na janela Módulos | baixo |
| 7 | Teste no Holyrics em janela, sem a TV | baixo |

## 5. A confirmar com o Holyrics aberto

O Holyrics não abre nesta máquina (o iniciador sai com código 2; ver HANDOFF). Antes da etapa 2:
- se módulos rodam na versão grátis (a documentação só diz que o modo desenvolvimento e `CreateText` exigem Plan);
- limite de slides em `ShowQuickPresentation` (testar mensagem com mais de 120 §);
- se `h.itemChooser` lida bem com 100 resultados;
- opção B: se o `.exe` na biblioteca roda sem bloqueio do antivírus.

## 6. Grátis e sempre funcionando (pergunta do Isaac, 2026-10-16)

Pela documentação oficial (jslib README e modules/README.md), **só exigem Holyrics Plan**: o modo desenvolvimento (2.29), `event_id` (mexer na lista de outro culto), criar/editar/apagar itens (`CreateItem`, `EditItem`, `DeleteItem`, `CreateText`…), trocar o culto selecionado e `popupAPIAuth`. **Não aparecem como pagos:** a janela Módulos com um módulo colado, `ShowQuickPresentation`, `ShowVerse`, `AddToPlaylist` na lista aberta, `module.executeCmdAndWait`/`process` e `module.apiRequest`.

Caminho grátis e sempre funcional = **opção B**:
- módulo colado na janela Módulos (sem modo desenvolvimento);
- `avdp-consulta.exe` na biblioteca do Holyrics (aba Arquivos), chamado por `module.executeCmdAndWait`, lendo o `avdp.db`;
- não depende do AVDP aberto, de internet, de porta nem de token; depende só do Holyrics aberto, do `.exe` liberado (`allowed_files`) e do banco no PC.

A confirmar com o Holyrics aberto: se a versão grátis roda módulo próprio (a documentação não diz que é pago, mas também não diz que é grátis) e se o antivírus aceita o `.exe`. O Holyrics hoje não abre nesta máquina (o iniciador sai com código 2) — isso precisa ser resolvido antes.

## 7. Riscos e alternativa

- Opção A depende do AVDP aberto; opção B depende de permissão de arquivo e do antivírus.
- Interface de diálogo mais limitada que a do AVDP.
- Se a "execução condicional" do módulo ficar desligada, os itens `module_action` da lista falham sem aviso.
- **Alternativa sem módulo (já pronta):** o AVDP projeta as mensagens na própria janela e manda os versículos ao Holyrics pela API (`ShowVerse` com ACF/NVI/KJA; falta preencher o token).

## 8. Como ficou (2026-10-18)

Decisões do Isaac: banco **próprio, só de mensagens**, em pasta fixa fora da biblioteca (`C:\AVDP Holyrics\avdp-mensagens.db`, 222 MB); ele abre o Holyrics por fora do Claude e projeta em janela; "não sei se roda módulo sem Plan, testamos" → **roda** no Holyrics grátis 2.30.0.

Peças:
- `app/avdp-consulta/` — pacote Rust separado (não entra no `tauri build`). Usa por `#[path]` os próprios `db.rs`, `messages.rs`, `search.rs`, `text.rs`, `themes.rs` do app; `error.rs` próprio (sem Tauri/rede/zip). Comandos `info`, `search`, `group`, `paragraphs`, `filas`, `fila`, `make-db`, `eco`, `chunk`. Saída JSON numa linha, só ASCII; texto livre nos argumentos em hexadecimal (`x:` + UTF-8). Banco aberto só para leitura; sem `-wal` ao lado (AVDP fechado) abre como `immutable=1`, para não criar `-shm`/`-wal` ao lado do banco do AVDP. 34 testes (`cargo test`).
- `app/avdp-consulta/modulo/avdp-mensagens.js` — o módulo (ES5). Botões: Pesquisar mensagem, Abrir por data, Adicionar à lista, Importar fila do AVDP, Conferir. Ação pública `show_paragraph`.
- Pacote: `AVDP Busca\Plugin Holyrics\` (zip de 108 MB, `INSTALAR.cmd`, `ATUALIZAR-BANCO-DO-PLUGIN.cmd`, LEIA-ME).

O que a documentação (conferida em 2026-10-18) e o teste mudaram em relação às seções 1–7:
- `h.fileChooser()` escolhe arquivo **da biblioteca** do Holyrics (devolve `id`, `name`, `isDir`), não um caminho qualquer. A fila `.avdpfila` é achada pelo programa (Downloads, Área de Trabalho, Documentos, pasta do plugin) ou digitada.
- O limite de 500 ms (100–4000) da documentação é do `hly('ModuleAction')`; o do item da lista não é documentado. A ação pública devolve logo e faz o trabalho num `module.setTimeout`. No teste, o duplo clique no item projetou certo.
- Texto da apresentação rápida só tem formatação se começar com `<styled>` (não precisa escapar texto comum). O rodapé código + § usa `<styled>…\n<size:55><i>…</i></size>`.
- **`executeCmdAndWait` do 2.30.0 acrescenta uma quebra de linha a cada 8192 caracteres da saída** (medido com o comando `eco`: 64000 → 64034 caracteres, 32000 → +3, 16000 → +1, 8000 inteiro). Isso quebrava o `JSON.parse` de toda pesquisa. Como o JSON do programa é uma linha só, o módulo tira todas as quebras antes de ler. Por garantia ainda existe a resposta em pedaços (`--max-out` + `chunk`, conferidos pelo tamanho, limite medido na primeira consulta).
- Item `module_action` na lista **não tem nome**: aparece como o nome da ação pública ("Mostrar mensagem do AVDP"). Por isso o padrão passou a ser `plain_text` ("63-0324N O Sétimo Selo — §177 [GVD]", texto do § até o fim); a ação do módulo fica como opção.
- `GetCurrentQuickPresentation` não serviu para saber o slide na tela; `GetCurrentPresentation` devolve `type: quick_presentation`, `slide_number` e `total_slides` (ex.: 211 de 483).
- `ShowQuickPresentation` aceitou 483 slides (63-0324N, 415 §) com `initial_index`; a navegação é a do Holyrics.
- Janela Módulos: barra de módulos > ⋮ > "Módulos (Editar)" > "Código" / "Configurações" > "Permissões avançadas" (`allowed_files`). Menu de botão direito (`popup_menu`) da ação não apareceu para o Isaac; "Conferir" virou botão.
- Log do módulo (`module.log`) fica em `C:\Holyrics\logs\module\<id do módulo>.txt` (o Explorador mostra 0 bytes, mas o conteúdo está lá).
