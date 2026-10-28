# AVDP Busca

Passador de letras no estilo do Holyrics, com Bíblia (ACF, NVI, KJA e outras) e Mensagens (busca no estilo do The Table).
Windows e Mac. Versão atual: **1.5.0** · Plugin para o Holyrics: **AVDP Busca Plugin 1.5.0** (Windows).

> Repositório **privado**: tem as Bíblias ACF/NVI/KJA e o banco de mensagens (no Releases), que são protegidos por direito autoral. Não tornar público.

## ⬇️ Baixar a versão mais recente

### **[github.com/isaac20dss/AVDP-Busca/releases/latest](https://github.com/isaac20dss/AVDP-Busca/releases/latest)**

Abra o link acima e baixe, em **Assets** (lá embaixo), o arquivo do seu caso:

| Quero… | Baixe |
|---|---|
| Instalar no **Windows** pela primeira vez (programa + banco) | `AVDP-Busca-1.4.0-instalar-com-banco.zip` ([release v1.4.0](https://github.com/isaac20dss/AVDP-Busca/releases/tag/v1.4.0)) e depois atualizar |
| Instalar no **Mac** pela primeira vez (programa + banco) | `AVDP-Busca-1.4.0-Mac-instalar-com-banco.zip` ([release v1.4.0](https://github.com/isaac20dss/AVDP-Busca/releases/tag/v1.4.0)) e depois atualizar |
| **Atualizar** o Windows: AVDP Busca **e** Plugin de uma vez (já tem o banco) | `AVDP-Busca-1.5.0-atualizar-Windows.zip` → extrair → `ATUALIZAR.cmd` |
| **Atualizar** só o AVDP Busca no Windows | `AVDP.Busca_1.5.0_x64-setup.exe` |
| **Atualizar** o Mac Apple Silicon (M1, M2, M3…) | `AVDP.Busca_1.5.0_aarch64.dmg` |
| **Atualizar** o Mac Intel | `AVDP.Busca_1.5.0_x64.dmg` |
| Usar dentro do **Holyrics** (Windows), 1ª vez | `AVDP-Busca-Plugin-Holyrics-1.4.0.zip` ([release v1.4.0](https://github.com/isaac20dss/AVDP-Busca/releases/tag/v1.4.0)) e depois `ATUALIZAR.cmd` |
| Instalar as **fontes de letra** dos temas no computador (para o Holyrics mostrar igual) | `AVDP-Busca-Fontes.zip` → extrair → `INSTALAR-FONTES.cmd` (Windows) ou `instalar-fontes.command` (Mac) |

"Com banco" = instalador **+** banco de dados pronto (mensagens, Bíblias, temas, fundos). O banco que já existir no computador vai para
uma pasta de backup (nada é apagado). Os arquivos soltos (`.exe`, `.dmg`) só trocam o programa e mantêm o banco.

### Novidades da 1.5.0
- **Fontes de letra de fora**: no editor de tema, a Fonte lista também as **instaladas no computador** (Arial, Calibri…) e o botão
  de importar aceita arquivo de fonte (`.ttf`, `.otf`, `.woff`, `.woff2`).
- **Aba Textos** também no AVDP Busca Plugin (Holyrics).
- Trocar **Parágrafos ⇄ Slides** mantém o mesmo parágrafo no centro da tela.
- **Tamanho da letra digitado**: escreva o número inteiro (ex.: 15); vale ao sair da caixa ou com Enter.
- **Referência bíblica não se parte** entre slides ("Mat. 16:17", "Is. 54:13", "I Cor. 2:6-16").

**Atualizar outro computador (Windows)**: baixe `AVDP-Busca-1.5.0-atualizar-Windows.zip`, extraia, feche Holyrics/AVDP e dê dois
cliques em `ATUALIZAR.cmd`. Troca o AVDP Busca, o AVDP Busca Plugin e o `avdp-consulta.exe` do módulo; bancos e configurações ficam.

### Novidades da 1.4.0
- **Sincronizar automaticamente** (Configurações → Mensagens): ao abrir, baixa o que for novo ou revisado no Tabernáculo da Fé e no
  Busca CBB; mensagens que você corrigiu não mudam. Desligado, o programa avisa quando há novidade online.
- **Só ref.** num trecho (ex.: versículos 1 a 14) mostra **"João 3:1-14"** na prévia e no telão.
- **AVDP Busca Plugin** para o Holyrics: um botão "AVDP Busca" dentro do Holyrics abre o AVDP numa janela à parte; o que você projeta
  aparece no Holyrics exatamente como na prévia do AVDP.

---

## Instalar no Windows

1. Baixe `AVDP-Busca-1.4.0-instalar-com-banco.zip` ([versão mais recente](https://github.com/isaac20dss/AVDP-Busca/releases/latest)).
2. Botão direito no zip → **Extrair tudo…** → **Extrair**. (Não rode de dentro do zip.)
3. Feche o AVDP Busca, se estiver aberto.
4. Na pasta extraída, dois cliques em **`INSTALAR.cmd`**. Ele guarda o banco antigo em
   `%APPDATA%\br.avdp.busca\backup-AAAAMMDD-HHMMSS\`, copia o banco novo e abre o instalador → **Avançar** até o fim.
5. Se o Windows mostrar "O Windows protegeu o computador": **Mais informações → Executar assim mesmo** (o programa não tem certificado pago).
6. Abra o **AVDP Busca** pelo menu Iniciar.

**Atualizar**: rode só o `AVDP.Busca_…_x64-setup.exe`. Instala por cima e mantém o banco.

---

## Instalar no Mac

1. Baixe `AVDP-Busca-1.4.0-Mac-instalar-com-banco.zip` ([versão mais recente](https://github.com/isaac20dss/AVDP-Busca/releases/latest)).
2. Dois cliques no zip: o Mac extrai numa pasta ao lado (em Transferências).
3. Feche o AVDP Busca, se estiver aberto (Cmd+Q).
4. **Botão direito** (ou Control+clique) em **`instalar.command`** → **Abrir** → **Abrir**.
   - "Desenvolvedor não identificado" é esperado (sem certificado da Apple). Sem o botão **Abrir**:
     **Ajustes do Sistema → Privacidade e Segurança → Abrir Mesmo Assim**, e abra de novo.
5. No Terminal, o script guarda o banco antigo em `~/Library/Application Support/br.avdp.busca/backup-…/`, copia o banco novo,
   escolhe o `.dmg` do seu processador e instala o **AVDP Busca** em **Aplicativos**. Em "Pronto", aperte Enter.
6. Abra o **AVDP Busca** em **Aplicativos** (ou Launchpad).

**Atualizar**: baixe o `.dmg` do seu Mac (`aarch64` = Apple Silicon, `x64` = Intel), abra e arraste o AVDP Busca para
**Aplicativos** (substituir). Na primeira abertura: botão direito → **Abrir**.

**Diferenças no Mac**: **Cmd (⌘)** no lugar do Ctrl nos atalhos · **F8/F9/F10** com **fn** (ou "Usar F1, F2… como teclas de função"
em Ajustes → Teclado) · **Cmd+Espaço** é do Spotlight (troque o atalho de mídia em Configurações → Atalhos) · projeção: escolha
o monitor em Configurações → Projeção e desligue o espelhamento das telas · o **plugin do Holyrics** é só Windows.

---

## Instalar o plugin no Holyrics (Windows)

Funciona no **Holyrics grátis** (testado na 2.30.0). O AVDP Busca Plugin **não substitui** o AVDP Busca: os dois podem ficar no
mesmo computador e usam o mesmo banco.

**Parte 1 — no Windows (uma vez por computador)**
1. Baixe `AVDP-Busca-Plugin-Holyrics-1.4.0.zip` ([versão mais recente](https://github.com/isaac20dss/AVDP-Busca/releases/latest)).
2. Botão direito → **Extrair tudo…** → **Extrair**.
3. **Feche o Holyrics.** Na pasta extraída, dois cliques em **`INSTALAR.cmd`** (se o Windows avisar: **Mais informações → Executar assim mesmo**).
   A janela preta faz sozinha:
   - instala o **AVDP Busca Plugin**;
   - põe o banco do AVDP em `%APPDATA%\br.avdp.busca` (só se ainda não houver um — o que existe não é trocado);
   - cria `C:\AVDP Holyrics\` com o banco do módulo;
   - copia o `avdp-consulta.exe` para a biblioteca do Holyrics (`C:\Holyrics\Holyrics\files\media\file`; se o Holyrics estiver
     em outra pasta, ela pergunta) e testa;
   - deixa o **código do módulo copiado** (Ctrl+V no passo 6).

**Parte 2 — no Holyrics (uma vez)**

4. Abra o Holyrics.
5. Na barra de módulos (abaixo de "Favoritos"): **⋮** (três pontinhos, à esquerda) → **Módulos (Editar)** → **Adicionar** →
   JavaScript. Nome: **AVDP Busca**.
6. No módulo novo: **Código** → Ctrl+A → **Ctrl+V** → **Salvar**. Deixe o módulo marcado (ativado).
7. **Configurações** do módulo → **Permissões avançadas** → **allowed_files** → marque **avdp-consulta.exe**.
8. **Arquivo → Configurações → API Server**: marque **Ativado** em "API Server - Local" e anote a **Porta** (padrão 8091).
   Em **Gerenciar permissões**, crie um token (nome "AVDP Busca"), libere **ShowImage**, **ShowVerse** e
   **CloseCurrentPresentation** (ou todas) e copie o token.
9. Clique no botão **AVDP Busca** da barra de módulos: abre o AVDP Busca Plugin. Na **engrenagem** (canto de cima, à direita) →
   **Holyrics**: Endereço `127.0.0.1`, a Porta do passo 8 e o token → **Salvar e testar**.
   Se o Holyrics não estiver em `C:\Holyrics`, ajuste também **Pasta Imagens do Holyrics** (`…\Holyrics\files\media\image`).

**Usar**: no AVDP Busca Plugin, Projetar, setas, F8/F9/F10 e Esc vão para o Holyrics, idênticos à prévia. **Ir para Holyrics**
(canto de cima, à esquerda) volta; o botão **AVDP Busca** traz a janela de novo. Nas configurações do módulo,
**Mostrar todas as opções** liga os outros botões (pesquisar e projetar mensagens direto, importar fila…).
Para testar sem a TV: no Holyrics, **Configurações de exibição → Ocultar tela**.

Passo a passo completo e soluções de problemas: [`Plugin Holyrics/LEIA-ME - PASSO A PASSO.txt`](Plugin%20Holyrics/LEIA-ME%20-%20PASSO%20A%20PASSO.txt).

---

## O que tem neste repositório (pastas)

Para instalar, **nenhuma pasta daqui é necessária**: use o Releases (acima). As pastas servem para mexer no programa ou montar pacotes.

| Pasta / arquivo | O que é | O que fazer com ela |
|---|---|---|
| `app/` | código do programa (Tauri + Rust + React) | só para compilar ou alterar o programa (ver "Compilar" abaixo) |
| `app/src/` | tela (React/TypeScript) | editar a interface |
| `app/src-tauri/` | parte em Rust: banco, busca, Bíblia, mensagens, projeção | editar o funcionamento; `cargo test --lib` testa |
| `app/avdp-consulta/` | programa `avdp-consulta` e módulo `.js` do plugin do Holyrics, **só Windows** | ver "Instalar o plugin no Holyrics" acima |
| `app/src-tauri/tauri.plugin.conf.json` | configuração do **AVDP Busca Plugin** (mesmo código, outro nome/identificador) | `npx tauri build --config src-tauri/tauri.plugin.conf.json` |
| `app/mac/` | `instalar.command` e `LEIA-ME.txt` do pacote do Mac | entram no zip do Mac (`app/tools/pacote-mac.py`); não rodar daqui |
| `app/tools/` | testes automáticos (Windows) e scripts de pacote | uso de desenvolvimento |
| `BÍBLIA/` | ACF, NVI e KJA em JSON, SQLite e XML | **já estão dentro do banco** do pacote. Só use se instalar sem banco: AVDP → Configurações → Bíblias → **Importar arquivo** (sigla ACF/NVI/KJA, arquivo `.json` ou `.xml` da pasta) |
| `fontes/` | fontes de letra dos temas (Montserrat, Inter, Lato, Open Sans, Merriweather, Roboto Slab; TTF, licenças OFL/Apache em `licencas/`) | o programa já traz as fontes dentro dele; instale no sistema para o Holyrics: `INSTALAR-FONTES.cmd` (Windows, sem administrador) ou `instalar-fontes.command` (Mac). Depois feche e abra o Holyrics |
| `Plugin Holyrics/` | passo a passo do plugin do Holyrics | ler o `LEIA-ME - PASSO A PASSO.txt` (o zip do plugin não está no git) |
| `docs/` | pesquisa, arquitetura, melhorias propostas, prints do gauntlet | só leitura |
| `.github/workflows/build.yml` | gera os instaladores Windows e Mac no GitHub | roda sozinho ao criar uma tag `v…` |
| `LEIA-ME.md` | como o programa funciona (busca, fila, Holyrics, testes) | leitura |
| `HANDOFF.md` | estado completo do projeto e decisões | ler antes de mexer no código |

**Fora do repositório** (grandes demais ou locais): o banco `avdp.db` (vai pelo Releases), `node_modules/`, pastas `target*/` de compilação, os zips de pacote e `database-mensagens/`.

---

## Compilar (desenvolvimento)

Precisa de: **Node 24**, **Rust** (stable), e no Windows o **Visual Studio Build Tools** (C++); no Mac, `xcode-select --install`.

```bash
git clone https://github.com/isaac20dss/AVDP-Busca.git
cd AVDP-Busca/app
npm ci
npx tauri dev      # abre o programa em modo de teste
npx tauri build    # gera o instalador (Windows: .exe em src-tauri/target/release/bundle/nsis)
```

No Mac: `npx tauri build --bundles dmg` (gera o `.dmg` do processador do Mac).
Sem banco, o programa abre vazio: copie o `banco/avdp.db` de um pacote do Releases para a pasta de dados
(Windows `%APPDATA%\br.avdp.busca\`, Mac `~/Library/Application Support/br.avdp.busca/`) com o programa fechado.

**Gerar instaladores pelo GitHub** (sem ter um Mac): crie uma tag e envie (`git tag v1.4.1 && git push origin v1.4.1`), ou em
**Actions → Build → Run workflow** informe a tag. O GitHub compila Windows + Mac e anexa ao release.
Pacote "com banco" do Mac: `python app/tools/pacote-mac.py <saida.zip> <pasta banco> <dmg aarch64> <dmg x64>`.
