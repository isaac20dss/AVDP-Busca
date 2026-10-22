// Desempenho do app de PRODUÇÃO (sem os atalhos de teste), para comparar versões na mesma cópia do banco.
// Abrir o exe com AVDP_DATA_DIR=<cópia>, WEBVIEW2_USER_DATA_FOLDER=<pasta> e --remote-debugging-port=9222, depois:
//   node tools/perf-release.mjs <rótulo>
import { chromium } from 'playwright-core'

const label = process.argv[2] ?? 'versão'
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const main = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().includes('projection'))
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const r = { versao: label }
const info = await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('app_info'))
if (!/ClaudeTmp|scratchpad/i.test(info.data_dir)) throw new Error(`pasta de dados não é de teste: ${info.data_dir}`)
r.versao = `${label} (${info.version})`

// partida: 3 recargas
const starts = []
for (let i = 0; i < 3; i++) {
  const t = Date.now()
  await main.reload()
  await main.waitForFunction(() => document.querySelector('.tabs') && !document.querySelector('.loading'), null, { timeout: 60000 })
  starts.push(Date.now() - t)
}
r.partida_ms = med(starts)
r.js_carregado_kb = await main.evaluate(() =>
  Math.round(performance.getEntriesByType('resource').filter((e) => /\.js($|\?)/.test(e.name)).reduce((n, e) => n + (e.decodedBodySize || e.transferSize || 0), 0) / 1024),
)
await main.waitForTimeout(2000)

const timeInv = async (cmd, args, n = 7) => {
  const ts = []
  for (let i = 0; i < n; i++) ts.push(await main.evaluate(async ([c, a]) => { const t = performance.now(); await window.__TAURI_INTERNALS__.invoke(c, a); return performance.now() - t }, [cmd, args]))
  return Math.round(med(ts))
}
const opts = { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10 }
const q = (query) => ({ q: { query, opts, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 200, offset: 0 } })
r.pesquisa_deus_ms = await timeInv('msg_search', q('deus'))
r.pesquisa_jesus_ms = await timeInv('msg_search', q('jesus cristo'))
r.pesquisa_selo_ms = await timeInv('msg_search', q('sétimo selo'))
r.lista_ms = await timeInv('msg_list', { q: { filter: '', only_with_text: true, only_multi: false, sort: 'date', limit: 300, offset: 0 } })

// abrir a mensagem grande pela tela e mover a prévia com as setas
await main.click('.tabs button:nth-child(3)')
await main.click('.subtabs.top button:has-text("Mensagens")').catch(() => {})
await main.fill('.msg-panel .panel-head input.search', '63-0324N')
await main.waitForTimeout(800)
const tOpen = await main.evaluate(async () => {
  const li = [...document.querySelectorAll('.msg-panel .result-list li')].find((l) => l.textContent.includes('63-0324N'))
  const t = performance.now()
  li.click()
  while (document.querySelectorAll('.reader-body .para').length < 300 && performance.now() - t < 20000) await new Promise((res) => setTimeout(res, 5))
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
  return performance.now() - t
})
r.abrir_mensagem_grande_ms = Math.round(tOpen)
await main.click('.reader-body .para >> nth=1')
const keys = []
for (let i = 0; i < 15; i++) {
  keys.push(
    await main.evaluate(async () => {
      const t = performance.now()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
      return performance.now() - t
    }),
  )
}
r.seta_na_previa_ms = Math.round(med(keys) * 10) / 10

console.log(JSON.stringify(r))
await browser.close()
