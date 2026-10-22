Rodada 5 — 2026-10-16, tarde (carimbos nos artefatos em UTC: R5 14:58)

**Regra (pedido do Isaac):** o design fica como está; o gauntlet julga **só função, dados e bugs**. Melhorias novas são propostas em `docs/MELHORIAS.md` para ele escolher; o que o AVDP já faz melhor não se mexe.

**Escolhido para esta rodada:** R7 (frases ao digitar), R8 (peso igual entre formas expandidas), R9 (títulos diretos seguem a consulta), R10 (`"a b"~N` e parênteses) e exportar a lista para o Holyrics. Também saiu o botão "Papel de parede" da Mídia.

| Parte | R4 | **R5** | Maior falha que resta (proposta, não escolhida) |
|---|---|---|---|
| Busca de mensagens (crítico × recursos do The Table) | The Table, estreita | **AVDP Busca venceu, estreita** | O mesmo parágrafo aparece uma vez por tradução no topo (M1) |
| Exportar para o Holyrics (crítico × documentação oficial da API) | — | **Sólido com correções** (aplicadas) | Falta testar no Holyrics de verdade: como ele divide `plain_text` em slides e o comportamento com versão/id inválidos |
| Bíblia | Holyrics, estreita | (não julgada de novo) | Versículo rápido por cima do que está no ar (R1) |
| Operação e letras | Holyrics, clara | (não julgada de novo) | Alerta e contagem regressiva (O1, R2) |

**Correções depois dos críticos da R5:**
- **Busca:** a aproximada dá peso também quando a palavra digitada não existe ("arebatamento" → "arrebatamento" primeiro); títulos diretos obedecem aos filtros de anos/local/tradução/fonte; o par sugerido mostra o que foi digitado, com acento ("o sétimo selo"); parênteses aninhados testados.
- **Exportação:**
  - confere as permissões do token antes e diz qual falta;
  - mostra para qual programação do Holyrics vai e pede confirmação;
  - a versão do item vira a chave do Holyrics (ACF → `pt_acf`);
  - ignora músicas arquivadas e prefere o mesmo artista;
  - música como texto mantém a ordem (refrão repete);
  - mensagem e texto vão cortados como no telão;
  - o botão trava enquanto envia e avisa em caso de demora (para não duplicar);
  - mensagens de erro do Holyrics ficam legíveis.
- **Bug sério achado no teste (existia antes):** o plugin de diálogo do Tauri troca o `window.confirm` por uma versão assíncrona. Com isso, nenhuma pergunta "Tem certeza?" segurava a ação: excluir música, lista, texto ou tema, remover Bíblia e restaurar atalhos aconteciam mesmo clicando em Cancelar. Agora todas esperam a resposta (`await confirm`), e o teste prova que Cancelar segura a exportação e a exclusão de lista.

**Verificação:**
- `app/tools/flow4.mjs`: **29 de 29** no app real. A exportação foi testada contra um Holyrics simulado, porque o Holyrics não abre nesta máquina e o token está vazio.
- `flow3.mjs` 42/42; `flow2.mjs` ok; 23 testes Rust; `tsc` e `vite build` ok.
- Os testes devolvem tudo como estava: configuração do Holyrics, favoritos e histórico; os itens temporários são apagados.

**Tempos:** as sugestões levam 0,25–0,8 s no build de teste, que roda sem otimização. No SQLite otimizado as mesmas consultas levaram 10–30 ms; conferir no instalado.

**Histórico:** R1 (tela principal AVDP / Bíblia Holyrics) → R2–R3 (função; ACF/NVI/KJA instaladas) → R4 (bugs B1–B13 + 12 funções) → R5 (busca passa o modelo do The Table; exportação para o Holyrics).
