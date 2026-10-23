// "Só ref." num trecho da Bíblia (João 3:1-14 em todos os slides), aviso de novidades online e a caixa
// "Sincronizar automaticamente". Usa a internet só para CONSULTAR (não baixa nada). Não projeta.
// Uso: node tools/cdp.mjs tools/flow12.mjs <pasta>
export default async ({ main }) => {
  const inv = (c, a = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [c, a])
  const results = []
  const check = (name, ok, info = '') => {
    results.push(ok)
    console.log(`${ok ? 'OK ' : 'FALHOU'} ${name}${info ? ` — ${info}` : ''}`)
  }
  await main.waitForFunction(() => window.__avdp && window.__avdpBible && document.querySelector('.tabs'), null, { timeout: 60000 })

  // trecho João 3:1-14 em sequência, com "Só ref."
  const r = await main.evaluate(async () => {
    const app = window.__avdp.getState()
    const before = { mode: app.settings.bibleRangeMode, only: app.settings.bibleOnlyRef }
    app.saveSettings({ bibleRangeMode: 'sequencia', bibleOnlyRef: true })
    const bible = window.__avdpBible.getState()
    await bible.go?.(43, 3)
    for (let i = 0; i < 40 && window.__avdpBible.getState().verses.length === 0; i++) await new Promise((r) => setTimeout(r, 100))
    window.__avdpBible.setState({ sel: Array.from({ length: 14 }, (_, i) => i + 1) })
    const mod = await import('/src/state/bible.ts')
    const { displaySlide } = await import('/src/store.ts')
    const item = mod.selectionItem()
    const shown = item ? item.slides.map((s) => displaySlide(item, s, window.__avdp.getState().settings)?.text) : []
    window.__avdpBible.setState({ sel: [] })
    app.saveSettings({ bibleRangeMode: before.mode, bibleOnlyRef: before.only })
    return { title: item?.title, n: shown.length, first: shown[0], last: shown[shown.length - 1] }
  })
  check('Só ref. no trecho: todos os slides mostram "João 3:1-14"', r.n === 14 && r.first === 'João 3:1-14' && r.last === 'João 3:1-14', JSON.stringify(r))

  const t0 = Date.now()
  const p = await inv('msg_online_pending').catch((e) => ({ erro: String(e) }))
  check('Consulta de novidades online responde (sem baixar)', typeof p.tdf === 'number' && typeof p.cbb === 'number', `${JSON.stringify(p)} em ${Date.now() - t0} ms`)

  await main.evaluate(() => window.__avdp.getState().setModal({ type: 'settings', tab: 'mensagens' }))
  await main.waitForTimeout(800)
  const box = await main.$$eval('label.frow', (ls) => ls.some((l) => l.textContent.includes('Sincronizar automaticamente')))
  check('Caixa "Sincronizar automaticamente" em Configurações → Mensagens', box)
  await main.evaluate(() => window.__avdp.getState().setModal(null))

  const ok = results.filter(Boolean).length
  console.log(`\n${ok}/${results.length} verificações OK`)
}
