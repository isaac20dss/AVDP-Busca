# Pesquisa (engenharia reversa) — AVDP Busca

Data: 2026-10-15. Ferramentas: REA 6.5.0 (atualizado de 6.4.0 nesta data), reflexão Java, inspeção da interface.

## Holyrics 2.30.0 (C:\Holyrics)

| Pergunta | Resposta | Evidência |
|---|---|---|
| Tecnologia | Java 8 (Swing + WebLaF), JRE próprio em `Holyrics\jre` | `lib/*.jar`, `jre/bin/java -version` = 1.8.0_102 |
| Bíblia | Arquivos `.bib` cifrados (AES) em `files\Bible LG\`; lógica em `lib/Bible-1.4.5.jar` (`com.limagiran.bible`) | REA `ev_deac86f1…` (inventário do JAR) |
| Músicas | `files\database.db` (SQLite, tabela `music`), conteúdo cifrado | esquema SQLite |
| Classes do programa | `lib\pack*.dat` (pacotes cifrados) | cabeçalho |
| Modelo da Bíblia | `Bible{version, abbrev, language, books, verses}`, `Book{id, name, abbrev, testament}`, `Verse{book, chapter, verse, verse_end, content}`; ID de versículo `BBCCCVVV` | reflexão do JAR; doc da API |
| API oficial | `POST http://IP:PORTA/api/{ação}?token=…`; `ShowVerse` (id `BBCCCVVV`), `GetBibleVersionsV2`, `GetBibleBooks`, `IdentifyVerseReferences`, `ShowText`, `ShowQuickPresentation`. **Não há ação que devolva o texto do versículo.** | github.com/holyrics/API-Server README |

**Decisão:** os arquivos cifrados do Holyrics (Bíblias licenciadas e músicas) não são abertos. A Bíblia do AVDP Busca usa a mesma estrutura (66 livros, abreviações e cores do Holyrics, ID `BBCCCVVV`), com texto de versões livres/importadas, e um botão que manda o versículo para o Holyrics pela API oficial (`ShowVerse`), que projeta com o texto licenciado dele. Músicas do Holyrics entram exportando-as no próprio Holyrics (TXT) e importando no AVDP Busca.

### Interface observada (tela principal)
- Menu: Arquivo, Novo, Editar, Música, Tema, Anúncios, Escala, Relatório, Ferramentas, Janelas, Compartilhar, Ajuda; botões ▶ ■ da projeção.
- Coluna esquerda: botão "Ir para Bíblia"; abas Letras, Texto, Áudio, Vídeo, Imagem; busca "Pesquisar... (Ctrl+F)"; lista de músicas (título + artista).
- Centro: barra (projetar, próximo, adicionar à lista, conferir, editar, grade, tom, excluir), "Histórico", slides da música em blocos; selecionado em azul.
- Direita: player, prévia da projeção, "Salvar Tema para Música", "Configurações de exibição".
- Coluna direita: Anotações; lista de reprodução (Letras | Mídia); coluna de Temas (miniaturas).
- Janela da Bíblia: grade de livros colorida por grupo (Pentateuco marrom, históricos laranja, poéticos vermelho, profetas roxo, evangelhos azul, Atos azul-petróleo, epístolas verde, Apocalipse verde-claro), grade de capítulos, grade de versículos, lista de versículos com até 3 versões lado a lado, rodapé de copyright, "Digite uma tecla para localizar rapidamente o versículo".
- Busca na Bíblia: Frase exata, Palavra inteira, Todas as palavras / Qualquer palavra; Toda Bíblia / AT / NT / Livro.
- Editor de música: título, artista, anotação, texto; slides gerados por parágrafo (linha em branco); "Configurar ordem" dos parágrafos (repetir refrão etc.).
- Tema: fundo (imagem/cor, estender), opacidade, fonte, tamanho %, negrito/itálico, espaçamento, alinhamento, efeito, contorno, sombra, margem.

## The Table 1.24.2.7 (VGR)

.NET 8 + WPF + CefSharp + Lucene.NET. Conteúdo só depois de login e protegido; nada baixado nesta máquina (`%LOCALAPPDATA%\VGR` vazio). Usado **só como modelo de pesquisa**.

| Recurso de busca | Evidência (REA, `VGR.Table.Lucene.dll`, `ev_60e5d24e…`) |
|---|---|
| Tipos: Todas as palavras, Frase exata, Proximidade, Busca por código do sermão | enum `SearchType {SermonProductIdLookup, AllWords, ExactPhrase, Proximity}` |
| Termos: qualquer (OR), exclusão (-), curinga, aproximado (fuzzy), peso (boost), campo (title:…), XOR | `Parser.Terms.{AnyTerm, OrTerm, XorTerm, ExcludeTerm, WildcardTerm, FuzzyTerm, BoostTerm, SpecifierTerm}` |
| Grupos: todas, qualquer, exatas, próximas (distância) | `Parser.TermContainers.{AllTerms, AnyTerms, ExactTerms, ProximalTerms}` |
| Código de data (ex. 65-1127B) | `TableSearchEngine.IsTermDateCode` |
| Acentos, números por extenso, variações (stemmer português) | `SpecialCharacterFoldingFilter`, `WordToNumberFilter`, `FolioPorAnalyzer` |
| Ordenar por relevância, data, título, local | `SearchConstants.SortBy{Relevance, Date, Title, Place}` |
| Trecho com destaque | `TableHitProcessor.GetSearchResultsExcerpt / GetHighlightedRecord` |
| Sugestões ao digitar | `Typeahead.GetTerms` |
| Histórico de buscas, marcações | `SqliteSearchHistory`, `SqliteHighlights` (`VGR.Table.Core`) |

## Busca CBB (PWA de https://www.crentesdabiblia.com.br/busca-cbb)

- API pública usada pelo site: `POST /api/mensagesSite` `{pagina, itensPorPagina, titulo?, descricao?, local?, dateInitial?, dateFinal?}` → `{id, titulo, data (AAAA-MM-DD), local, doc (PDFs), tipo, traducao, paragrafos (HTML <p>)}`; `POST /api/gruposMensages` → locais e datas; `GET /api/mensagesDownload` (download completo para uso offline, o mesmo do botão do app).
- Busca do site: texto, local, intervalo de anos, "Busca exata", ver por mensagem ou por parágrafo.
- O Chrome do Isaac já tem a cópia offline (IndexedDB, ~40 MB).

## Banco local (`database-mensagens`)

- `mensagens.db` (1207 linhas): `numero, titulo, data_sermao (AAAA-MMDD + sufixo M/N/T/C/A/X), traducao (GVD, CB, GO, MH, AM, VSA, MLE), texto, pdf_url, mp3_url, sermon_url`.
- 586 com texto (392 de PDF, 194 de HTML); 621 sem tradução em português.
- Texto com parágrafos numerados (`^\d+ `), cabeçalho com título, data, local e "Tradução: …".

## Bíblias livres encontradas

- EasySlides (`Documents\EasyslidesData\Admin\HolyBibles`): KJV e ASV (domínio público), formato MyBible (`books`, `verses`, `info`).
- eBible.org (download pelo próprio app): `porbrbsl` Bíblia Portuguesa Mundial (domínio público), `porbr2018` Bíblia Livre, `porblt` Bíblia Livre Para Todos, `poronbv` Nova Bíblia Viva (Biblica Open). Formato `{id}_vpl.zip`.
