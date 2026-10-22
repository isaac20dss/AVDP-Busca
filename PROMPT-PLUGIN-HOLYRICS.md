Retomar o projeto **AVDP Busca** (`C:\Users\Isaac\Documents\Claude\AVDP\AVDP Busca`) para fazer o **módulo (plugin) do Holyrics** com as Mensagens e a fila. Responda em caveman ultra: invoque a skill `caveman:caveman` com `ultra` antes de tudo.

**O pedido (palavras do Isaac, 2026-10-18):** "Agora eu quero que você crie um plugin somente com a parte das mensagens, com banco de dados que temos e com a parte da fila para o holyrics, quero um plugin diretamente no holyrics, faça para mim."

**Leia antes de mexer em qualquer coisa:**
1. `HANDOFF.md` inteiro. Principalmente:
   - seção 1, "Oitava leva": o pedido, o que já se sabe e as 3 decisões em aberto;
   - seção 2: regras;
   - seção 4, 6ª e 7ª levas: Tabernáculo da Fé, cópias escondidas e o formato `.avdpfila`;
   - seção 6: armadilhas, sobretudo "Claude empacotado".
2. `docs/PLANO-PLUGIN-HOLYRICS.md`: é a base. Opção B recomendada: módulo `.js` colado na janela Módulos + `avdp-consulta.exe` chamado por `module.executeCmdAndWait`.
3. Código que vai ser reaproveitado: `app/src-tauri/src/search.rs`, `messages.rs` (busca, grupos, `superseded_by`) e `transfer.rs` (formato da fila).

**Regras inegociáveis:**
- Não descriptografar nada do Holyrics nem do The Table (`lib\pack*.dat`, `.bib`, `database.db` do Holyrics são cifrados). Só a documentação oficial: github.com/holyrics/jslib (README) e github.com/holyrics/JSCommunity (`src/modules/README.md`, `example/example.js`). Ler páginas é permitido; baixar programa ou arquivo novo só com o meu ok.
- Nada desta pasta vai para o cofre Obsidian; não criar item de sincronização para o outro PC.
- **Nunca abrir o AVDP, o `avdp-consulta.exe` ou o `avdp.db` real pelo Claude.** O Claude roda empacotado (MSIX) e desvia `%APPDATA%`: em 2026-10-18 isso tirou meu banco do lugar. Teste sempre com uma cópia no scratchpad (`AVDP_DATA_DIR=<cópia>` no app; no `.exe`, um parâmetro `--db <cópia>`). Cópia boa: `Levar para outro PC\pacote\banco\avdp.db`.
- O Holyrics eu abro por fora do Claude. Nos testes, nada na minha TV: me pergunte antes de projetar e encerre a apresentação no fim.
- Perguntar antes de apagar dados meus. Atalho nunca é letra solta. Design do AVDP congelado.

**Faça, nesta ordem:**
1. **Confirme a documentação atual** do módulo para o Holyrics 2.30.0 (versão instalada em `C:\Holyrics\Holyrics`): `info()`, `actions`, `publicActions`, `module.executeCmdAndWait`, permissão `allowed_files`, `ShowQuickPresentation` (`slides`, `initial_index`), `AddToPlaylist` (`module_action`, `plain_text`, `verse`) e `h.itemChooser`/`h.inputV2`. Anote o que mudou em relação ao plano.
2. **Me pergunte as 3 decisões da oitava leva** (banco do plugin e onde fica; como eu abro e testo o Holyrics; se meu Holyrics roda módulo próprio) numa pergunta só, com opções.
3. **`avdp-consulta.exe`** (Rust):
   - Subcomandos com saída JSON UTF-8: `search` (mesma sintaxe e modos da pesquisa do AVDP, sem as cópias escondidas), `group --code 65-1127B`, `paragraphs --variant N` e `fila --file x.avdpfila` (converte a fila do AVDP em itens do Holyrics).
   - Abre o banco só para leitura e tem `--db`.
   - Faça como pacote separado ou binário com `default-run`, para não atrapalhar o `tauri build` do AVDP.
   - Testes com `cargo test` e chamadas reais na cópia do banco.
4. **Módulo `avdp-mensagens.js`** (um arquivo para colar na janela Módulos):
   - `info()` com `id: 'avdp_mensagens'`, `min_version`, `os_required: 'windows'` e `permissions` `allowed_files`; `settings()` com tema, caracteres por slide e rodapé com código + §.
   - Ações:
     - Pesquisar mensagem: texto, modo e anos → lista → projetar a mensagem inteira a partir do § ou adicionar à lista.
     - Abrir por data.
     - Adicionar à lista do Holyrics.
     - Importar fila do AVDP (`.avdpfila`).
   - `publicActions` `show_paragraph`, para o item da lista buscar o texto na hora.
   - Trate erro e resposta vazia; respeite o tempo curto das ações vindas da lista.
5. **Pacote** em `AVDP Busca\Plugin Holyrics\`: o `.js`, o `.exe`, o banco (se for o caso) e um `LEIA-ME - PASSO A PASSO.txt` (como pôr o `.exe` na biblioteca, colar o módulo, liberar a permissão, usar). Faça também um zip para eu levar ao outro PC pelo Drive, como o do AVDP.
6. **Teste comigo no Holyrics:** eu abro o Holyrics, você me guia. Teste em janela ou prévia, sem a TV: pesquisar, projetar, navegar, adicionar à lista, importar a fila. Confira mensagem com mais de 120 §.
7. **Atualize** `HANDOFF.md` (nova leva), `LEIA-ME.md` e `docs/PLANO-PLUGIN-HOLYRICS.md`.

No fim, me diga em poucas linhas o que ficou pronto, o que testamos no Holyrics e onde está o pacote.
