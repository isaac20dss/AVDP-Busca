# Melhorias propostas (gauntlet de função) — para o Isaac decidir

Data: 2026-10-16. Origem: críticos independentes da rodada 2/3 (A = busca de mensagens × The Table, B = Bíblia × Holyrics, C = operação e letras × Holyrics). **Nada daqui foi aplicado.** O visual fica como está; só função, dados e bugs.

Responda com os números que quer (ex.: "B1–B13, M1, Bi1, O1").

**Aplicado na rodada 5 (2026-10-16):** R7, R8, R9, R10 e exportar para o Holyrics (botão na lista; ver `LEIA-ME.md`); o botão "Papel de parede" da Mídia saiu. Testado: `app/tools/flow4.mjs`, 22 verificações.

**Aplicado na rodada 4 (2026-10-16, escolha do Isaac):** todos os bugs **B1–B13**, **M9**, **Bi1, Bi3, Bi5, Bi6, Bi8, Bi9, Bi11** (como opção), **Bi12**, **O2**, **O5**. Testado no app real (`app/tools/flow3.mjs`, 42 verificações). O resto da lista continua só como proposta. Custo: baixo (minutos a 1 h), médio (algumas horas), alto (um dia ou mais).

## Já corrigido nesta sessão (bugs)
- Texto cortado ao projetar texto grande logo depois de abrir o telão: a medida do encaixe rodava antes da fonte do tema carregar. Agora mede de novo quando a fonte chega e quando a janela muda de tamanho; o texto só aparece já encaixado.
- Bíblia mostrava capítulo vazio quando a versão escolhida não tinha o livro (BPM sem João, Marcos…): agora usa outra versão instalada e avisa.
- Mensagens: ordenar por título, local ou data no modo parágrafo dava erro de SQL (`no such column: v.title_fold`).
- Bíblia: pesquisa só AT / só NT dava erro (`Wrong number of parameters… Got 3, needed 2`).
- Bíblia: `jd 5`, `fm 3-6`, `3jo 14` (livros de um capítulo) não eram reconhecidos.
- ACF, NVI e KJA instaladas a partir dos seus arquivos (ACF principal). Limpeza feita na importação: 723 primeiras palavras de capítulo em caixa alta na ACF ("NO princípio" → "No princípio", como o Holyrics mostra) e 710 espaços antes de pontuação na NVI ("Unigênito ," → "Unigênito,").

## Bugs pequenos que ainda restam (recomendo corrigir)
| # | Bug | Evidência | Custo |
|---|---|---|---|
| B1 | Botão ⏭ do centro, com a música fora do ar, projeta o slide seguinte ao selecionado (pula o 1º); no último, reprojeta o mesmo | `SlidesView.tsx` (C) | baixo |
| B2 | A dica da tela vazia de Letras cita atalhos que não existem ("Espaço" próximo, "B" preto); os reais são →, F10, Esc | `SlidesView.tsx` (C) | baixo |
| B3 | "Mostrar rodapé nas letras" (Configurações) não faz nada: os slides de letra nunca montam rodapé | `slides.ts` (C) | baixo |
| B4 | "Mais tocadas" soma de novo ao voltar à mesma música depois de outro item | `store.ts` (C) | baixo |
| B5 | Estrofes numeradas pela posição do parágrafo ("1, Refrão, 3") | `slides.ts` (C) | baixo |
| B6 | Curinga no meio (`pro?eta`) vira prefixo `pro*`: 57.790 resultados em ~1 s | A | baixo |
| B7 | `XOR` e `^3` viram palavras e dão 0 resultado sem aviso | A | baixo |
| B8 | Leitor de mensagem destaca palavras soltas e plurais numa busca de frase ("Selos" em "sétimo selo") | A | baixo |
| B9 | Pesquisa da Bíblia só AT leva ~900 ms (por livro: 6 ms) | B | baixo |
| B10 | Item de Bíblia na lista guarda livro/capítulo/versículo sem a versão: o rótulo "— BPM" pode não bater com o que reabre | C | baixo |
| B11 | Painel ao vivo mostra o tema do tipo, não o da música (latente: hoje nenhuma música tem tema próprio) | C | baixo |
| B12 | Trecho da Bíblia ("1co 13:4-7") é reconhecido mas só o v. 4 é projetado, guardado na lista e mandado ao Holyrics | B (rodada 3) | baixo |
| B13 | Pesquisa da Bíblia diz "353 versículos" e mostra só 300, sem aviso nem "mais" | B (rodada 3) | baixo |

## Melhorias — busca de mensagens (crítico A: The Table venceu por margem estreita)
| # | Melhoria | Por quê | Custo |
|---|---|---|---|
| M1 | Juntar traduções iguais num resultado só (data + §), com os selos das traduções; idem no modo "por mensagem" | o mesmo § aparece 2–3 vezes no topo em 10 de 19 buscas. **Em parte resolvido** (2026-10-16, fonte Tabernáculo da Fé): cópia do banco local/CBB com o mesmo texto da revisão do site fica escondida da pesquisa. Ainda sobram cópias iguais entre banco local e CBB onde o site não tem a mensagem | médio |
| M2 | Código de data com sufixo VGR exato (65-1127**B** → uma mensagem só) | hoje devolve 65-1127C e 65-1127N; tabela de sufixos a confirmar | baixo |
| M3 | Número ↔ extenso (sete = 7, sétimo = 7º) | The Table faz; "sete selos" 472 × "7 selos" 52; exige reindexar | médio |
| M4 | Limpar o campo "local" (texto do sermão foi parar nele) e unificar grafias (4 jeitos de Jeffersonville/Phoenix) | filtro e ordem por local ficam sem valor | médio |
| M5 | Resultados diretos (títulos) coerentes: aceitar "fé", usar aproximada nos títulos, marcar "sem texto em português" | "arebatamento" não traz "O Arrebatamento" | baixo |
| M6 | `XOR` e peso `^n` de verdade | The Table tem | baixo |
| M7 | Proximidade: menor distância primeiro | "anjo… luz elétrica" ao lado de "anjo de luz" | baixo |
| M8 | Não destacar nem pesar "de / a / o" | o destaque pinta o trecho inteiro | baixo |
| M9 | Sugestões ao digitar (títulos e palavras do índice) | The Table tem | médio |
| M10 | Marcações no texto da mensagem | The Table tem; pouco uso no culto | médio |

## Melhorias — Bíblia (crítico B)
| # | Melhoria | Por quê | Custo |
|---|---|---|---|
| Bi1 | Projetar um trecho ("1co 13:4-7") como vários versículos juntos ou em sequência; dividir versículo longo | Holyrics faz; a referência já é entendida | médio |
| Bi2 | Variações melhores: "amar" não trazer "Amarias"; incluir ama/amou/amado; exato primeiro | stemmer junta nome próprio e separa conjugações | médio |
| Bi3 | Favoritos e histórico de versículos | Holyrics tem na janela da Bíblia | médio |
| Bi4 | Comparar o versículo em todas as versões instaladas | Holyrics tem | médio |
| Bi5 | Opção "só a referência" na projeção | Holyrics tem; útil na pregação | baixo |
| Bi6 | Se a versão cair para outra língua, Enter só mostra a prévia e pede confirmação | hoje entrou inglês ao vivo (caso BPM) | baixo |
| Bi7 | Aviso no app quando a ponte do Holyrics está sem token | **o token está vazio no banco**; preencha em Configurações → Holyrics | baixo |
| Bi8 | Ctrl+B passar só pelas versões escolhidas (ACF/NVI/KJA), ou atalhos diretos Ctrl+Alt+1/2/3 | hoje de ACF a NVI são 5 toques, passando por inglês e pela BPM | baixo |
| Bi9 | Ordem dos resultados "Bíblia / relevância" | "no princípio" põe Jo 1:2 antes de Gn 1:1 | baixo |
| Bi10 | Pesquisa por palavras mais rápida no AT/NT (índice por versão) | AT 1,5 s; livro 8 ms; Bíblia toda 9–40 ms | médio |
| Bi11 | Dividir versículo longo em slides e mostrar o começo do próximo | Holyrics tem (2.6 e 2.28) | médio |
| Bi12 | Escolher versículos fora de sequência com Ctrl/Shift | Holyrics tem (2.26) | médio |
| Bi13 | Leitura alternada e apresentação automática de uma lista de versículos | Holyrics tem | alto |

Rodada 3 (com ACF/NVI/KJA): o crítico achou que "variações" de "amar" não acha João 3:16 ("amou") — reforça Bi2.

## Melhorias — operação e letras (crítico C: Holyrics venceu por margem clara)
| # | Melhoria | Por quê | Custo |
|---|---|---|---|
| O1 | Alerta no rodapé (berçário, carro) por cima de qualquer item, com atalho | Holyrics tem; uso em todo culto | médio |
| O2 | Tela de retorno/palco num 2º monitor: slide atual, próximo e anotação | maior lacuna apontada | médio |
| O3 | Refrão automático em hinos (repete após cada estrofe; opção) | Holyrics tem "ordem de hinário" | baixo |
| O4 | Mostrar a anotação da música no painel ao vivo | campo existe e fica invisível | baixo |
| O5 | Criar a lista do dia sozinha quando a última não for de hoje | Holyrics gera por culto | baixo |
| O6 | Tema por música (escolher no editor; usado ao projetar) | Holyrics tem "Salvar Tema para Música" | baixo |
| O7 | "Ir para" slide com Alt+1…9 e Alt+R (refrão) — nunca tecla solta | Holyrics tem "Go to" | médio |
| O8 | Um formato só para o rótulo dos itens de mensagem na lista | hoje há dois | baixo |
| O9 | Contagem regressiva e relógio no papel de parede | Holyrics tem | médio |
| O10 | Histórico por culto (músicas cantadas em cada lista) | hoje só contador | médio |
| O11 | Corrigir só o slide ao vivo, sem abrir o editor | Holyrics tem | médio |
| O12 | Grupos/tags de música (hinário, corinhos) com filtro | hoje o grupo vai no campo artista | médio |
| O13 | Tom e BPM na música | Holyrics tem | baixo |
| O14 | Fundo de vídeo no tema | Holyrics tem | alto |

## Não mexer (o AVDP já é melhor, segundo os críticos)
- Busca de mensagens: filtros por anos/local/tradução/fonte/"só a escolhida", modo "por mensagem", resultados diretos por título/código, código sem sufixo e formato longo (1965-1127), coerência entre caixas e sintaxe, 5–185 ms em 212.802 parágrafos.
- Leitor de mensagens: selos de tradução, comparar lado a lado, "Usar esta tradução", aviso ≈%, procurar dentro da mensagem com §, duplo clique projeta do parágrafo, lista guarda o §.
- Bíblia: leitor de referência (17/17 acertos, inclusive livro de um capítulo), pesquisa com próximas/aproximada/acentos em 4–16 ms, referência reconhecida na caixa de pesquisa, aviso de versão de reserva, contador e próximo versículo no painel.
- Letras: busca com trecho destacado, ranking e "nada exato → aproximada"; busca geral Ctrl+K; importação ampla com remoção de cifras.
- Atalhos que recusam letra solta; mídia por caminho sem copiar; "Projetar pelo Holyrics" pela API oficial.

## Plugin no Holyrics
Plano separado: `docs/PLANO-PLUGIN-HOLYRICS.md` (módulo JavaScript do Holyrics falando com o AVDP por uma API local).

## Rodada 4 — novas propostas dos críticos (nada aplicado)
Itens já listados acima continuam valendo (M1–M8, M10, Bi2, Bi4, Bi7, Bi10, Bi13, O1, O3, O4, O6–O14).

| # | Melhoria | Por quê | Custo |
|---|---|---|---|
| R1 | Versículo rápido por cima da música/mensagem, com atalho para voltar ao item e ao parágrafo que estavam no ar | pregador cita versículo no meio da leitura; Holyrics faz desde a 2.18 | médio |
| R2 | Contagem regressiva no telão e cronômetro/contagem na tela de palco | início do culto e tempo do pregador; o palco já tem relógio | baixo |
| R3 | Mensagem do operador para o palco ("último refrão", "encerrar") | o palco já existe; equivale ao Painel de Comunicação do Holyrics | baixo |
| R4 | Comentário por slide (só no palco) | a anotação por música não diz em que estrofe agir | baixo |
| R5 | Palco com todas as slides do item, a atual destacada | os músicos veem a estrutura inteira | médio |
| R6 | Histórico de letras e mídia projetadas, com reprojeção em 1 clique | voltar a um item já usado no mesmo culto | baixo |
| R7 | Sugestões de pares de palavras ("sete se" → "sete selos") | hoje a sugestão olha só a última palavra | médio |
| R8 | Curinga e aproximada com peso igual entre as formas (hoje `pro?eta` abre com "prometa", a forma rara) | o bm25 favorece a forma rara | baixo |
| R9 | Resultados diretos por título obedecendo ao modo (E, XOR, exclusão) | "fé XOR obras" traz o título "Fé Sem Obras É Morta" | baixo |
| R10 | Proximidade e parênteses na sintaxe (`"anjo luz"~5`, `(a OU b) c`) | The Table tem | médio |
| R11 | Reserva por versículo (não só por capítulo vazio) e alinhamento de numeração NVI × ACF lado a lado | BPM tem versículos soltos faltando; NVI tem 3 a mais | médio |
| R12 | Servidor local: página do telão para OBS e controle pelo celular | transmissão e operação longe do PC; Holyrics tem app e NDI | médio |
| R13 | Importar o acervo de músicas do Holyrics (TXT exportado) em lote, com relatório | o banco está sem músicas; a busca de letras só pode ser julgada com acervo real | baixo |
| R14 | Cifra no palco com troca de tom | só se a banda usa cifra | alto |

## Rodada 5 — novas propostas dos críticos (nada aplicado)
| # | Melhoria | Por quê | Custo |
|---|---|---|---|
| S1 | Na fonte Busca CBB, ler o prefixo "NNN-" do texto como o número do § e tirá-lo do texto | o pregador cita pelo parágrafo; hoje §128 pode abrir o parágrafo errado e a tela mostra "128-" | médio |
| S2 | Frases ao digitar a partir de uma tabela pronta de pares/trios de palavras (em vez de amostra) | contagem exata em parágrafos e resposta instantânea | médio |
| S3 | Na busca ao vivo, tratar a última palavra ainda incompleta como começo de palavra (`se` → `se*`) | a lista atrás das sugestões hoje mostra "se" solto destacado | baixo |
| S4 | Apelido em português para títulos que estão em inglês na base ("Brass Serpent" ↔ "Serpente de Bronze") | "serpente de bronze" não acha o título em inglês | baixo |
| S5 | Exportação: testar uma vez no Holyrics de verdade (precisa do token e do Holyrics abrindo) | como o Holyrics divide `plain_text` em slides não está documentado | baixo |
