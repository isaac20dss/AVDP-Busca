# AVDP Busca

Passador de letras no estilo do Holyrics, com Bíblia (ACF, NVI, KJA e outras) e Mensagens (busca no estilo do The Table).
Windows e Mac. Versão atual: **1.3.0**.

> Repositório **privado**: tem as Bíblias ACF/NVI/KJA e o banco de mensagens (no Releases), que são protegidos por direito autoral. Não tornar público.

---

## O que baixar

Para **usar** o programa, não precisa do código: baixe o pacote pronto em
**[Releases → v1.3.0](https://github.com/isaac20dss/AVDP-Busca/releases/tag/v1.3.0)** (lá embaixo, em *Assets*).

| Seu computador | Baixe | Tamanho |
|---|---|---|
| Windows | `AVDP-Busca-1.3.0-instalar-com-banco.zip` | 172 MB |
| Mac (Apple Silicon ou Intel) | `AVDP-Busca-1.3.0-Mac-instalar-com-banco.zip` | 185 MB |

"Com banco" = instalador **+** o banco de dados já pronto (mensagens, Bíblias, fundos). É o que você quer na primeira instalação.
Os arquivos soltos (`…_x64-setup.exe`, `….dmg`) são só o programa, sem banco: servem para atualizar um computador que já tem o banco.

---

## Instalar no Windows

1. Baixe `AVDP-Busca-1.3.0-instalar-com-banco.zip` (tabela acima).
2. Botão direito no zip → **Extrair tudo…** → **Extrair**. (Não rode de dentro do zip.)
3. A pasta extraída tem:
   | Arquivo / pasta | O que é |
   |---|---|
   | `INSTALAR.cmd` | **é este que você abre** |
   | `AVDP Busca_1.3.0_x64-setup.exe` | instalador (o `INSTALAR.cmd` abre sozinho) |
   | `banco\` | banco de dados (`avdp.db`) e imagens de fundo (`fundos\`) |
   | `LEIA-ME.txt` | este passo a passo, resumido |
4. Feche o AVDP Busca, se estiver aberto.
5. Dois cliques em **`INSTALAR.cmd`**. Ele:
   - guarda o banco que já existir em `%APPDATA%\br.avdp.busca\backup-AAAAMMDD-HHMMSS\` (nada é apagado);
   - copia o banco novo para `%APPDATA%\br.avdp.busca\`;
   - abre o instalador → **Avançar** até o fim.
6. Se o Windows mostrar "O Windows protegeu o computador": **Mais informações → Executar assim mesmo** (o programa não tem certificado pago).
7. Abra o **AVDP Busca** pelo menu Iniciar.

**Atualizar** (já tem o banco): rode só o `AVDP.Busca_…_x64-setup.exe` do Releases. Instala por cima e mantém o banco.

---

## Instalar no Mac

1. Baixe `AVDP-Busca-1.3.0-Mac-instalar-com-banco.zip` (tabela acima).
2. Dois cliques no zip: o Mac extrai numa pasta ao lado (em Transferências).
3. A pasta extraída tem:
   | Arquivo / pasta | O que é |
   |---|---|
   | `instalar.command` | **é este que você abre** |
   | `AVDP Busca_1.3.0_aarch64.dmg` | programa para Mac Apple Silicon (M1, M2, M3…) |
   | `AVDP Busca_1.3.0_x64.dmg` | programa para Mac Intel |
   | `banco/` | banco de dados (`avdp.db`) e imagens de fundo (`fundos/`) |
   | `LEIA-ME.txt` | este passo a passo, resumido |

   Não precisa saber qual é o seu processador: o `instalar.command` escolhe o `.dmg` certo.
4. Feche o AVDP Busca, se estiver aberto (Cmd+Q).
5. **Botão direito** (ou Control+clique) em **`instalar.command`** → **Abrir** → **Abrir**.
   - O Mac avisa "desenvolvedor não identificado" porque o programa não tem certificado da Apple. É esperado.
   - Se não aparecer o botão **Abrir**: **Ajustes do Sistema → Privacidade e Segurança** → lá embaixo, **Abrir Mesmo Assim** → volte e abra de novo.
6. Abre o Terminal e o script:
   - guarda o banco que já existir em `~/Library/Application Support/br.avdp.busca/backup-AAAAMMDD-HHMMSS/`;
   - copia o banco novo para `~/Library/Application Support/br.avdp.busca/`;
   - instala o **AVDP Busca** em **Aplicativos** e libera a abertura dele.
7. Quando aparecer "Pronto", aperte Enter e feche o Terminal.
8. Abra o **AVDP Busca** pela pasta **Aplicativos** (ou Launchpad).

**Atualizar** (já tem o banco): baixe o `.dmg` do seu Mac (`aarch64` = Apple Silicon, `x64` = Intel), abra e arraste o AVDP Busca para **Aplicativos** (substituir). Na primeira abertura: botão direito → **Abrir**.

### Diferenças no Mac
- **Cmd (⌘) no lugar do Ctrl** em todos os atalhos: Cmd+F pesquisa, Cmd+1…5 trocam a aba, Cmd+K busca geral.
- **F8 / F9 / F10** (papel de parede, sem texto, tela preta): aperte com **fn** (fn+F8…), ou ligue em
  Ajustes do Sistema → Teclado → "Usar as teclas F1, F2 etc. como teclas de função padrão".
- **Cmd+Espaço** é do Spotlight: troque o atalho de tocar/pausar mídia em Configurações → Atalhos.
- **Projeção**: em Configurações → Projeção escolha o monitor. Se o Mac estiver **espelhando** as telas, desligue em Ajustes → Telas.
- O **plugin do Holyrics** (`avdp-consulta`) é só para Windows.

---

## O que tem neste repositório (pastas)

Para instalar, **nenhuma pasta daqui é necessária**: use o Releases (acima). As pastas servem para mexer no programa ou montar pacotes.

| Pasta / arquivo | O que é | O que fazer com ela |
|---|---|---|
| `app/` | código do programa (Tauri + Rust + React) | só para compilar ou alterar o programa (ver "Compilar" abaixo) |
| `app/src/` | tela (React/TypeScript) | editar a interface |
| `app/src-tauri/` | parte em Rust: banco, busca, Bíblia, mensagens, projeção | editar o funcionamento; `cargo test --lib` testa |
| `app/avdp-consulta/` | plugin do Holyrics (programa + módulo `.js`), **só Windows** | ver `Plugin Holyrics/LEIA-ME - PASSO A PASSO.txt` |
| `app/mac/` | `instalar.command` e `LEIA-ME.txt` do pacote do Mac | entram no zip do Mac (`app/tools/pacote-mac.py`); não rodar daqui |
| `app/tools/` | testes automáticos (Windows) e scripts de pacote | uso de desenvolvimento |
| `BÍBLIA/` | ACF, NVI e KJA em JSON, SQLite e XML | **já estão dentro do banco** do pacote. Só use se instalar sem banco: AVDP → Configurações → Bíblias → **Importar arquivo** (sigla ACF/NVI/KJA, arquivo `.json` ou `.xml` da pasta) |
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

**Gerar instaladores pelo GitHub** (sem ter um Mac): crie uma tag e envie (`git tag v1.3.1 && git push origin v1.3.1`), ou em
**Actions → Build → Run workflow** informe a tag. O GitHub compila Windows + Mac e anexa ao release.
Pacote "com banco" do Mac: `python app/tools/pacote-mac.py <saida.zip> <pasta banco> <dmg aarch64> <dmg x64>`.
