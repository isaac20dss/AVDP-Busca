// Régua do modo Holyrics (AVDP Busca Plugin): do "projetar" até o ShowImage chegar ao Holyrics SIMULADO, com o
// tema "Noite azul" (fundo pesado). Mediana de 11 slides. Fotos numa pasta temporária. Não toca o Holyrics real.
// Uso: node tools/cdp.mjs tools/perf-holyrics.mjs <pasta>
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default async ({ main }) => {
  const inv = (c, a = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [c, a])
  let w = null
  const srv = http.createServer((q, r) => {
    q.resume()
    q.on('end', () => {
      if (q.url.includes('ShowImage') && w) {
        w(Date.now())
        w = null
      }
      r.end('{"status":"ok"}')
    })
  })
  await new Promise((r) => srv.listen(18091, '127.0.0.1', r))
  const lib = mkdtempSync(join(tmpdir(), 'avdp-perf-'))
  const orig = (await inv('get_settings')).holyrics ?? ''
  await inv('set_setting', { key: 'holyrics', value: JSON.stringify({ host: '127.0.0.1', port: 18091, token: 'x' }) })
  const s0 = await main.evaluate(() => {
    const s = window.__avdp.getState()
    return { dir: s.settings.holyricsImageDir, tk: s.settings.themeByKind }
  })
  try {
    await main.evaluate((d) => {
      const s = window.__avdp.getState()
      s.enterHolyricsMode()
      s.saveSettings({ holyricsImageDir: d, themeByKind: { ...s.settings.themeByKind, message: 3 } })
    }, lib)
    const m = { kind: 'message', key: 'message:perf', title: 'Perf', ref: {}, slides: Array.from({ length: 12 }, (_, i) => ({ text: 'Porque Deus amou o mundo de tal maneira que deu o seu Filho unigênito ' + i, footer: '63-0324N · O Sétimo Selo · §' + i })) }
    const one = (i) =>
      new Promise((res) => {
        const t = Date.now()
        w = (at) => res(at - t)
        main.evaluate(([x, k]) => window.__avdp.getState().project(x, k), [m, i])
        setTimeout(() => res(null), 10000)
      })
    console.log('1ª projeção', await one(0), 'ms')
    await main.waitForTimeout(500)
    const ts = []
    for (let i = 1; i <= 11; i++) ts.push(await one(i))
    ts.sort((a, b) => a - b)
    console.log('mediana', ts[5], 'ms', JSON.stringify(ts))
  } finally {
    await main.evaluate((d) => {
      const s = window.__avdp.getState()
      s.endPresentation()
      s.saveSettings({ holyricsImageDir: d.dir, themeByKind: d.tk })
    }, s0)
    await inv('set_setting', { key: 'holyrics', value: orig })
    srv.close()
    rmSync(lib, { recursive: true, force: true })
  }
}
