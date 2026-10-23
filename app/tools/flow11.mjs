// AVDP Busca Plugin / modo Holyrics: janela só com Mensagens e Bíblia, "Ir para Holyrics" e recarregar, e o slide
// vai ao Holyrics como FOTO da projeção do AVDP (igual à prévia) — contra um Holyrics SIMULADO (servidor local que só
// registra; o de verdade não é tocado). As fotos vão para uma pasta temporária no lugar da aba Imagens do Holyrics.
// Seguro: devolve as configurações, sai do modo e fecha a janela escondida.
// Uso: node tools/cdp.mjs tools/flow11.mjs <pasta-de-prints>
// AVDP_EXE=<avdp-busca.exe do tauri dev> testa também a 2ª instância com --holyrics (plugin single-instance).
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default async ({ main, shot }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const st = (fn, arg) => main.evaluate(fn, arg)
  const results = []
  const check = (name, ok, info = '') => {
    results.push(ok)
    console.log(`${ok ? 'OK ' : 'FALHOU'} ${name}${info ? ` — ${info}` : ''}`)
  }
  const sleep = (ms) => main.waitForTimeout(ms)
  await main.waitForFunction(() => window.__avdp && document.querySelector('.tabs'), null, { timeout: 60000 })
  await main.evaluate(() => window.__avdp.getState().setModal(null))

  const got = []
  let waiters = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const action = new URL(req.url, 'http://x').pathname.replace('/api/', '')
      const g = { action, data: body ? JSON.parse(body) : {}, at: Date.now() }
      got.push(g)
      waiters = waiters.filter((w) => !(w.action === action && (w.resolve(g), true)))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ status: 'ok', data: null }))
    })
  })
  const next = (action, ms = 8000) =>
    Promise.race([new Promise((resolve) => waiters.push({ action, resolve })), new Promise((r) => setTimeout(() => r(null), ms))])
  await new Promise((r) => server.listen(18091, '127.0.0.1', r))
  const lib = mkdtempSync(join(tmpdir(), 'avdp-holyrics-img-'))
  const orig = await inv('get_settings')
  const before = await st(() => {
    const s = window.__avdp.getState()
    return { tab: s.tab, via: s.settings.bibleViaHolyrics, dir: s.settings.holyricsImageDir, footer: s.settings.msgFooter, themeByKind: s.settings.themeByKind }
  })
  const png = (file) => {
    const p = join(lib, ...file.split('/'))
    if (!existsSync(p)) return null
    const b = readFileSync(p)
    // JPEG: largura e altura no marcador SOF (FFC0/FFC2)
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) break
      const m = b[i + 1]
      if (m === 0xc0 || m === 0xc2) return { size: b.length, w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), sig: 'JPEG' }
      i += 2 + b.readUInt16BE(i + 2)
    }
    return { size: b.length, sig: '?' }
  }
  try {
    await inv('set_setting', { key: 'holyrics', value: JSON.stringify({ host: '127.0.0.1', port: 18091, token: 'teste-simulado' }) })
    await st((d) => window.__avdp.getState().saveSettings({ bibleViaHolyrics: false, holyricsImageDir: d }), lib)
    const plugin = (await inv('app_info')).identifier === 'br.avdp.busca.plugin'
    if (plugin) check('AVDP Busca Plugin abre direto no modo Holyrics', (await inv('holyrics_mode')) === true && (await st(() => window.__avdp.getState().holyricsMode)))
    else check('Aberto sem --holyrics: modo normal', (await inv('holyrics_mode')) === false && !(await st(() => window.__avdp.getState().holyricsMode)))

    if (plugin) {
      /* já no modo */
    } else if (process.env.AVDP_EXE) {
      const p = spawn(process.env.AVDP_EXE, ['--holyrics'], { env: process.env, stdio: 'ignore' })
      const code = await new Promise((r) => {
        p.on('exit', r)
        setTimeout(() => r('não saiu'), 15000)
      })
      await sleep(500)
      check('2ª instância com --holyrics sai e liga o modo na janela aberta', code === 0 && (await st(() => window.__avdp.getState().holyricsMode)), `saída ${code}`)
    } else {
      await st(() => window.__avdp.getState().enterHolyricsMode())
      console.log('(sem AVDP_EXE: modo ligado direto pelo store)')
    }
    await sleep(300)
    const tabs = await main.$$eval('.tabs button', (b) => b.map((x) => x.textContent.trim()))
    check('Só as abas Mensagens e Bíblia', tabs.join('|') === 'Bíblia|Mensagens', tabs.join('|'))
    const order = await main.$$eval('.topbar > *', (els) => els.map((e) => e.className))
    check('"Ir para Holyrics" é o 1º da barra, antes da logo', order[0] === 'go-holyrics' && order[1] === 'brand', order.slice(0, 2).join(' , '))
    check('Botão de recarregar no lugar antigo (direita)', (await main.$$('.live-controls button[title^="Recarregar o plugin"]')).length === 1)
    check('Sem monitor/projeção do AVDP; selo "Pelo Holyrics"', (await main.$$('.monitor-select')).length === 0 && (await main.$$('.holyrics-badge')).length === 1)
    await main.click('.tabs button:has-text("Mensagens")')
    await shot('90-modo-holyrics')

    // mensagem: foto da projeção → aba Imagens → ShowImage
    const msg = { kind: 'message', key: 'message:teste:1', title: 'Teste', ref: {}, slides: [{ text: 'Primeiro slide de teste', footer: '63-0324N · §1' }, { text: 'Segundo', footer: '63-0324N · §2' }, { text: 'Terceiro' }] }
    got.length = 0
    let t0 = Date.now()
    await st((m) => window.__avdp.getState().project(m, 1), msg)
    const a = await next('ShowImage', 15000)
    const first = a ? a.at - t0 : null
    const f1 = a && png(a.data.file)
    check('Projetar = foto JPEG 1920×1080 na pasta "AVDP ao vivo" + ShowImage', !!f1 && f1.sig === 'JPEG' && f1.w >= 1900 && f1.h >= 1060 && /^AVDP ao vivo\/slide-/.test(a.data.file), `${a?.data.file} ${JSON.stringify(f1)} em ${first} ms (abre a janela escondida)`)
    check('Janela de projeção fica escondida fora da tela', await st(() => window.__avdp.getState().projectionOpen))
    const times = []
    for (const d of [1, -1, 1, -1, 1]) {
      t0 = Date.now()
      await st((x) => window.__avdp.getState().step(x), d)
      const g = await next('ShowImage')
      if (g) times.push(g.at - t0)
    }
    times.sort((x, y) => x - y)
    check('Seta: nova foto a cada slide', times.length === 5, `mediana ${times[2]} ms (${times.join(', ')})`)
    const before2 = got.filter((g) => g.action === 'ShowImage').length
    await st(() => window.__avdp.getState().saveSettings({ fadeMs: 299 }))
    const e = await next('ShowImage')
    check('Mudou configuração no AVDP: Holyrics atualiza sozinho', !!e && got.filter((g) => g.action === 'ShowImage').length > before2)
    const themes = await st(() => window.__avdp.getState().themes.map((t) => t.id))
    await st((id) => window.__avdp.getState().saveSettings({ themeByKind: { ...window.__avdp.getState().settings.themeByKind, message: id } }), themes[1])
    const e2 = await next('ShowImage')
    const f2 = e2 && png(e2.data.file)
    check('Trocou o tema: Holyrics recebe a foto com o tema novo', !!f2 && f2.size !== f1?.size, `${f1?.size} → ${f2?.size} bytes`)
    got.length = 0
    await st(() => window.__avdp.getState().setBlank('black'))
    const b = await next('ShowImage')
    check('F10 (tela preta) vai como foto', !!b && got.every((g) => g.action === 'ShowImage'))
    await st(() => window.__avdp.getState().setBlank('black'))
    await next('ShowImage')
    got.length = 0
    await st(() => window.__avdp.getState().endPresentation())
    await sleep(800)
    check('Esc fecha a apresentação do Holyrics (sem foto nova)', got.map((g) => g.action).join() === 'CloseCurrentPresentation', JSON.stringify(got.map((g) => g.action)))
    const left = (await import('node:fs')).readdirSync(join(lib, 'AVDP ao vivo'))
    check('Pasta guarda só as 3 últimas fotos', left.length <= 3, left.length + ' arquivos')

    // Bíblia licenciada do Holyrics continua por referência
    await st(() => window.__avdp.getState().saveSettings({ bibleViaHolyrics: true }))
    const verse = { kind: 'verse', key: 'verse:teste', title: 'João 3:16', ref: {}, slides: [{ text: 'Porque Deus amou o mundo…', footer: 'João 3:16 (ACF)', ref: { book: 43, chapter: 3, verse: 16 } }] }
    got.length = 0
    await st((v) => window.__avdp.getState().project(v, 0), verse)
    await sleep(800)
    check('Com "Projetar pelo Holyrics": ShowVerse, sem foto', got.map((g) => g.action).join() === 'ShowVerse' && JSON.stringify(got[0]?.data.ids) === '["43003016"]', JSON.stringify(got.map((g) => g.action)))
    await st(() => window.__avdp.getState().endPresentation())

    got.length = 0
    await st(() => window.__avdp.getState().project({ kind: 'media', key: 'media:x', title: 'x', ref: {}, slides: [{ text: '' }] }, 0))
    await sleep(300)
    check('Mídia não vai pelo Holyrics', got.length === 0)

    const minimized = () => inv('plugin:window|is_minimized', { label: 'main' })
    await main.click('.topbar .go-holyrics')
    await sleep(800)
    check('"Ir para Holyrics" minimiza a janela', (await minimized()) === true)
    if (process.env.AVDP_EXE) {
      const p = spawn(process.env.AVDP_EXE, ['--holyrics'], { env: process.env, stdio: 'ignore' })
      await new Promise((r) => p.on('exit', r))
      await sleep(800)
      check('Botão do módulo de novo traz a janela de volta', (await minimized()) === false)
    } else await inv('plugin:window|unminimize', { label: 'main' })
  } finally {
    await inv('set_setting', { key: 'holyrics', value: orig.holyrics ?? '' })
    await st((b) => {
      const s = window.__avdp.getState()
      s.saveSettings({ bibleViaHolyrics: b.via, holyricsImageDir: b.dir, msgFooter: b.footer, themeByKind: b.themeByKind, fadeMs: 300 })
      window.__avdp.setState({ holyricsMode: false })
      s.setTab(b.tab)
      document.title = 'AVDP Busca'
    }, before)
    await inv('projection_close').catch(() => {})
    await st(() => window.__avdp.setState({ projectionOpen: false }))
    await new Promise((r) => server.close(r))
    rmSync(lib, { recursive: true, force: true })
  }
  const ok = results.filter(Boolean).length
  console.log(`\n${ok}/${results.length} verificações OK`)
}
