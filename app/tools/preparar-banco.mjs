// Prepara o banco do pacote "instalar com banco": importa o zip das Eras/Selos e sincroniza o MessageHub
// inteiro, no exe de produção aberto com AVDP_DATA_DIR=<cópia>\br.avdp.busca e --remote-debugging-port=9222.
// Uso: node tools/preparar-banco.mjs "<caminho do Selos e Eras.zip>"
import { chromium } from 'playwright-core'

const zip = process.argv[2]
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const main = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().includes('projection'))
await main.waitForFunction(() => document.querySelector('.tabs') && !document.querySelector('.loading'), null, { timeout: 60000 })
const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
const info = await inv('app_info')
if (!/ClaudeTmp|scratchpad/i.test(info.data_dir)) throw new Error(`pasta de dados não é a cópia: ${info.data_dir}`)
console.log('app', info.version, info.data_dir)

if (zip) {
  const r = await inv('msg_import_books', { path: zip })
  console.log('zip:', JSON.stringify(r))
}

// MessageHub pela tela (a sincronização roda no front): Configurações → Mensagens → MessageHub → Sincronizar agora
await main.click('.topbar button[title^="Configurações"]')
await main.waitForSelector('.modal')
await main.click('.modal button:has-text("Mensagens")')
await main.waitForSelector('.modal h3:has-text("MessageHub")')
await main.evaluate(() => {
  const h = [...document.querySelectorAll('.modal h3')].find((x) => x.textContent.includes('MessageHub'))
  let el = h.nextElementSibling
  while (el && !el.classList.contains('row-buttons')) el = el.nextElementSibling
  el.querySelector('button.primary').click()
})
const t0 = Date.now()
let last = ''
for (;;) {
  await new Promise((r) => setTimeout(r, 15000))
  const s = await inv('get_settings')
  const prog = await main.evaluate(() => document.querySelector('.modal .progress span')?.textContent ?? '')
  if (prog !== last) {
    console.log(`${Math.round((Date.now() - t0) / 1000)} s: ${prog}`)
    last = prog
  }
  if (s.hub_synced_at && !(await main.evaluate(() => [...document.querySelectorAll('.modal button')].some((b) => b.textContent.includes('Sincronizando'))))) break
  if (Date.now() - t0 > 40 * 60 * 1000) throw new Error('MessageHub passou de 40 min')
}
const st = await inv('msg_stats')
const hint = await main.evaluate(() => [...document.querySelectorAll('.modal p.hint')].find((p) => p.textContent.includes('Última sincronização') && p.previousElementSibling?.querySelector?.('button'))?.textContent ?? '')
console.log('fim:', JSON.stringify({ grupos: st.groups, com_texto: st.with_text, paragrafos: st.paragraphs, escondidas: st.superseded, fontes: st.by_source }), hint.slice(0, 300))
await browser.close()
