// Automação do app real (WebView2) para testes: conecta pelo CDP e roda um roteiro.
// Uso: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npx tauri dev
//      node tools/cdp.mjs roteiro.mjs [saida-dir]
// O roteiro exporta `default async ({ main, projection, shot, browser }) => {}`.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [, , scriptPath, outDir = 'shots'] = process.argv
mkdirSync(outDir, { recursive: true })

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const pages = () => browser.contexts().flatMap((c) => c.pages())
const find = (pred) => pages().find((p) => pred(p.url()))
const main = find((u) => u.includes('localhost:1420') && !u.includes('projection'))
if (!main) {
  console.error('janela principal não encontrada:', pages().map((p) => p.url()))
  process.exit(1)
}
const shot = async (name, page = main) => {
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  console.log('print:', resolve(file))
  return file
}
const projection = () => find((u) => u.includes('projection'))
const errors = []
main.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
main.on('pageerror', (e) => errors.push(String(e)))

const mod = await import(pathToFileURL(resolve(scriptPath)).href)
try {
  await mod.default({ main, projection, shot, browser, pages })
} finally {
  if (errors.length) console.log('ERROS NO CONSOLE:\n' + errors.join('\n'))
  await browser.close().catch(() => {})
}
