// Teste rápido do app de PRODUÇÃO (exe de release ou instalado), sem projetar.
// Uso: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 src-tauri/target/release/avdp-busca.exe
//      node tools/release-smoke.mjs [pasta-de-prints]
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'shots'
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const pages = () => browser.contexts().flatMap((c) => c.pages())
let main
for (let i = 0; i < 40 && !main; i++) {
  main = pages().find((p) => !/#\/(projection|stage)/.test(p.url()))
  if (!main) await sleep(500)
}
if (!main) throw new Error('janela principal não encontrada')
const errors = []
main.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
main.on('pageerror', (e) => errors.push(String(e)))
const results = []
const check = (name, ok, info = '') => {
  results.push(ok)
  console.log(`${ok ? 'OK ' : 'FALHOU'} ${name}${info ? ` — ${info}` : ''}`)
}
const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])

await main.waitForSelector('.tabs', { timeout: 30000 })
check('Endereço de produção (não é o servidor de teste)', !main.url().includes('localhost:1420'), main.url())
check('Sem atalhos de teste (__avdp) na produção', await main.evaluate(() => typeof window.__avdp === 'undefined'))
const info = await inv('app_info')
const want = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
check(`Versão ${want}`, info.version === want, `${info.version} · ${info.data_dir}`)
const st = await inv('msg_stats')
check('Banco de mensagens carregado', st.groups > 1000 && st.paragraphs > 200000, `${st.groups} datas, ${st.paragraphs} §`)
const bibles = await inv('bible_list')
check('Bíblias instaladas', ['acf', 'nvi', 'kja'].every((id) => bibles.some((b) => b.id === id)), bibles.map((b) => b.abbrev).join(', '))

// fundo do papel de parede pelo protocolo de arquivos do app
const ui = JSON.parse((await inv('get_settings')).ui ?? '{}')
if (ui.wallpaperImage) {
  const status = await main.evaluate(async (p) => {
    const u = window.__TAURI_INTERNALS__.convertFileSrc(p)
    try {
      return (await fetch(u)).status
    } catch (e) {
      return String(e)
    }
  }, ui.wallpaperImage)
  check('Imagem de fundo abre no app instalado', status === 200, `${status} ${ui.wallpaperImage}`)
}

// pesquisa de mensagens pela tela
await main.click('.tabs button:nth-child(3)')
await sleep(800)
await main.click('.subtabs.top button:has-text("Pesquisar")')
await sleep(400)
await main.fill('.msg-panel input.search', 'sétimo selo')
// a 1ª pesquisa depois de abrir carrega o vocabulário (~1 s); as seguintes levam dezenas de ms
const t0 = Date.now()
await main.waitForSelector('.msg-results li:not(.direct)', { timeout: 15000 }).catch(() => {})
const n = await main.evaluate(() => document.querySelectorAll('.msg-results li').length)
check('Pesquisa de mensagens na tela', n > 0, `${n} itens em ${((Date.now() - t0) / 1000).toFixed(1)} s`)
await main.click('.msg-results li:not(.direct) >> nth=0')
await sleep(1200)
const paras = await main.evaluate(() => document.querySelectorAll('.reader-body .para').length)
check('Leitor abre a mensagem', paras > 0, `${paras} parágrafos`)
await main.fill('.msg-panel input.search', '')
await main.screenshot({ path: join(outDir, 'release-mensagens.png') })

// Bíblia
await main.click('.tabs button:nth-child(2)')
await sleep(1000)
const verses = await inv('bible_chapter', { bibles: ['acf'], book: 43, chapter: 3 }).catch((e) => String(e))
check('Bíblia ACF lê João 3', Array.isArray(verses) ? verses.length >= 36 : false, Array.isArray(verses) ? `${verses.length} versículos` : verses)
await main.screenshot({ path: join(outDir, 'release-biblia.png') })

// fila entre PCs: exporta uma lista com itens e importa de volta (a cópia é apagada no fim)
const lists = await inv('playlists_list')
const src = lists.find((l) => l.items > 0)
if (src) {
  const before = await inv('get_settings')
  const file = join(process.env.TEMP ?? '.', 'avdp-release-fila.avdpfila')
  let created = null
  try {
    const n = await inv('fila_export', { playlistId: src.id, path: file })
    const rep = await inv('fila_import', { path: file })
    created = rep.playlist_id
    check('Fila: exporta e importa no app de produção', n === src.items && rep.items === src.items && rep.missing.length === 0, `"${rep.name}", ${rep.items} itens`)
  } finally {
    if (created && created !== src.id) await inv('playlist_delete', { id: created })
    await inv('set_setting', { key: 'fila_imports', value: before.fila_imports ?? '{}' })
    const { rmSync } = await import('node:fs')
    rmSync(file, { force: true })
  }
}

check('Sem erros no console', errors.length === 0, errors.slice(0, 3).join(' | '))
console.log(`\n${results.filter(Boolean).length} de ${results.length} verificações`)
await browser.close()
