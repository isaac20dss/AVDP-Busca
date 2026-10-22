# AVDP Busca — desenho

Passador de letras no estilo Holyrics, com Bíblia e Mensagens. Uso pessoal do Isaac.

## Pilha
- **Tauri v2** (Rust) + **React 18 + TypeScript + Vite**. Instalador pequeno, WebView2 do Windows.
- **SQLite + FTS5** (rusqlite `bundled`) em `%APPDATA%\br.avdp.busca\avdp.db`. Tokenizador `unicode61 remove_diacritics 2` (acentos e maiúsculas não importam).
- Variações de palavra (stemmer português, `rust-stemmers`) e busca aproximada (Levenshtein sobre o vocabulário `fts5vocab`) por expansão de consulta.
- Importação de arquivos no front: PDF (`pdfjs-dist`), DOCX (`mammoth`), PPTX/ODT (`jszip`), HTML (`DOMParser`), TXT, XML do EasySlides, OpenLyrics, texto colado.

## Janelas
- `main`: operador (layout do Holyrics, tema escuro).
- `projection`: tela cheia no monitor escolhido; recebe o slide atual por evento (`projection://slide`), com transição em fade.

## Módulos
1. **Letras**: lista + busca melhorada; editor (título, artista, letra; linha em branco separa slides; ordem dos parágrafos); importação; lista de reprodução.
2. **Bíblia**: grade de livros com as cores do Holyrics, capítulos, versículos; até 3 versões lado a lado; atalho de referência (`jo 3 16`, `1co13:4-7`, `sl 23`); busca (frase exata, palavra inteira, todas/qualquer, AT/NT/livro) com ranking e destaque; "Enviar ao Holyrics" (API `ShowVerse`).
3. **Mensagens**: grupos por data (`AAAA-MMDD` + sufixo); cada grupo tem as traduções disponíveis (banco local, Busca CBB, importadas) e o usuário escolhe qual usar (memorizado). Busca no estilo The Table: todas as palavras, frase exata, proximidade (N palavras), qualquer palavra, sintaxe avançada (`"frase"`, `-excluir`, `OU`, `curinga*`, `palavra~`, `titulo:`), código de data (`65-1127`, `1958-0309N`), filtros (anos, local, tradução, fonte), ordem (relevância, data, título, local), resultados por parágrafo com trecho destacado, histórico. Leitor com números de parágrafo; selecionar parágrafos e projetar.
4. **Textos**: textos avulsos importados (PDF, DOCX, HTML, TXT) virando slides.
5. **Busca global** (Ctrl+K): músicas, versículos, referências e mensagens numa lista só.

## Fontes de dados
- Mensagens locais: `AVDP Busca\database-mensagens\mensagens.db`.
- Busca CBB: API pública `POST /api/mensagesSite` (paginada), sincronização pelo botão no app.
- The Table: conteúdo protegido; só o modelo de busca. Colar trechos copiados do The Table funciona pelo importador de texto.
- Bíblia: versões livres (eBible.org, baixadas pelo app), importação MyBible/EasySlides SQLite, Zefania XML, OSIS XML, VPL, JSON, CSV.

## ID de versículo
`BBCCCVVV` (livro 01–66, capítulo 3 dígitos, versículo 3 dígitos), igual ao Holyrics.
