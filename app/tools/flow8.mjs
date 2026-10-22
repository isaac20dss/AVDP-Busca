// 9ª leva (2): a pesquisa leva à palavra (centralizada) e não ao começo do parágrafo; a divisão das
// mensagens acompanha o tamanho da letra do tema (letra maior = menos texto por slide, sem encolher).
// SÓ com AVDP_DATA_DIR numa cópia do banco (muda o tamanho do tema e devolve no fim).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async ({ main, shot }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const st = (fn, arg) => main.evaluate(fn, arg)
  const results = []
  const check = (name, ok, info = '') => {
    results.push(ok)
    console.log(`${ok ? 'OK ' : 'FALHOU'} ${name}${info ? ` — ${info}` : ''}`)
  }
  await main.waitForFunction(() => window.__avdp && document.querySelector('.tabs'), null, { timeout: 60000 })
  const info = await inv('app_info')
  if (!/ClaudeTmp|scratchpad/i.test(info.data_dir)) throw new Error(`pasta de dados não é de teste: ${info.data_dir}`)
  await st(() => {
    const s = window.__avdp.getState()
    s.setModal(null)
    s.saveSettings({ monitor: null, slide: { ...s.settings.slide, autoChunk: true } })
  })

  // ---------- divisão pelo tamanho da letra ----------
  const sizes = await main.evaluate(async () => {
    const { fitChars, themeFor } = await import('/src/lib/fit.ts')
    const t = themeFor('message')
    return { theme: t.size, s7: fitChars({ ...t, size: 7 }), s14: fitChars({ ...t, size: 14 }), s30: fitChars({ ...t, size: 30 }) }
  })
  check('Letra maior = menos texto por slide', sizes.s7 > sizes.s14 && sizes.s14 > sizes.s30, JSON.stringify(sizes))

  // tema das mensagens com letra 14%: o slide não encolhe
  const themeId = await st(() => {
    const s = window.__avdp.getState()
    return s.settings.themeByKind.message ?? s.themes[0].id
  })
  const row = (await inv('themes_list')).find((t) => t.id === themeId)
  const before = JSON.parse(row.data)
  try {
    await inv('theme_save', { theme: { ...row, data: JSON.stringify({ ...before, size: 14 }) } })
    await st(() => window.__avdp.getState().loadThemes())
    await main.click('.tabs button:nth-child(3)')
    const grp = (await inv('msg_list', { q: { filter: '63-0324N', limit: 5, offset: 0 } })).rows[0]
    await main.evaluate((id) => window.__avdpMsg.getState().open(id, null, null), grp.id)
    await main.waitForSelector('.reader-body .para')
    await sleep(500)
    const n14 = await st(() => window.__avdp.getState().item.slides.length)
    // anda por alguns slides na prévia e mede o encolhimento (--fit) do texto
    const fits = []
    for (let i = 0; i < 12; i++) {
      await st((k) => window.__avdp.getState().setCursor(k), i)
      await sleep(120)
      fits.push(await main.$eval('.preview-panel .stage-text', (e) => +(getComputedStyle(e).getPropertyValue('--fit') || 1)))
    }
    check('Letra 14%: mais slides que antes (420 fixos davam 483)', n14 > 483, `${n14} slides`)
    check('Letra 14%: texto do slide não encolhe (fit ≥ 0,9)', Math.min(...fits) >= 0.9, fits.map((f) => f.toFixed(2)).join(' '))
    await shot('20-letra-14')
    // voltar para 7%: refaz os slides da mensagem aberta sozinho
    await inv('theme_save', { theme: { ...row, data: JSON.stringify({ ...before, size: 7 }) } })
    await st(() => window.__avdp.getState().loadThemes())
    await sleep(500)
    const n7 = await st(() => window.__avdp.getState().item.slides.length)
    check('Trocar o tamanho refaz a divisão da mensagem aberta', n7 < n14, `${n14} -> ${n7}`)
  } finally {
    await inv('theme_save', { theme: row })
    await st(() => window.__avdp.getState().loadThemes())
  }

  // ---------- pesquisa leva à palavra ----------
  await main.click('.subtabs.top button:has-text("Pesquisar")')
  await main.fill('.msg-panel input.search', '"cordeiro vem"')
  await main.waitForSelector('.msg-results li:not(.direct)', { timeout: 15000 })
  await sleep(600)
  // um resultado num parágrafo longo
  const pick = await main.evaluate(() => {
    const lis = [...document.querySelectorAll('.msg-results li:not(.direct)')]
    return lis.length
  })
  check('Pesquisa trouxe resultados', pick > 0, `${pick}`)
  let tested = false
  for (let k = 0; k < Math.min(pick, 15) && !tested; k++) {
    await main.click(`.msg-results li:not(.direct) >> nth=${k}`)
    await sleep(900)
    const r = await main.evaluate(() => {
      const body = document.querySelector('.reader-body')
      const para = document.querySelector('.reader-body .para.focus')
      const mark = para?.querySelector('p:not(.cmp) mark')
      if (!body || !para || !mark) return null
      const b = body.getBoundingClientRect()
      const m = mark.getBoundingClientRect()
      const p = para.getBoundingClientRect()
      const s = window.__avdp.getState()
      return { long: p.height > b.height * 0.6, markMid: m.top + m.height / 2 - (b.top + b.height / 2), bodyH: b.height, label: s.item?.slides[s.cursor]?.label, text: s.item?.slides[s.cursor]?.text }
    })
    if (!r) continue
    const inSlide = /cordeiro vem/i.test((r.text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, ''))
    if (k === 0 || r.long) {
      check(`Resultado ${k + 1}: a palavra fica no centro da tela`, Math.abs(r.markMid) < r.bodyH * 0.15, `${Math.round(r.markMid)} px do centro (altura ${Math.round(r.bodyH)})`)
      check(`Resultado ${k + 1}: a prévia é o pedaço com a frase`, inSlide, r.label)
      if (r.long) tested = true
    }
  }
  await shot('21-pesquisa-palavra')

  // procurar dentro da mensagem também vai à palavra
  await main.fill('.find-bar input', 'trombeta')
  await sleep(500)
  await main.press('.find-bar input', 'Enter')
  await sleep(500)
  const f = await main.evaluate(() => {
    const body = document.querySelector('.reader-body').getBoundingClientRect()
    const mark = document.querySelector('.reader-body .para.focus p:not(.cmp) mark')?.getBoundingClientRect()
    const s = window.__avdp.getState()
    return { mid: mark ? mark.top + mark.height / 2 - (body.top + body.height / 2) : null, h: body.height, text: s.item?.slides[s.cursor]?.text ?? '' }
  })
  check('Procurar na mensagem: palavra no centro', f.mid != null && Math.abs(f.mid) < f.h * 0.15, `${f.mid}`)
  check('Procurar na mensagem: prévia no pedaço da palavra', /trombeta/i.test(f.text))

  const ok = results.filter(Boolean).length
  console.log(`\n${ok}/${results.length} verificações OK`)
}
