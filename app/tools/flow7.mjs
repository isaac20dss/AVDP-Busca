// 9ª leva: prévia separada do ao vivo, leitor por slides, Ctrl+duplo clique, Bíblia na prévia, Esc fecha a
// projeção, fonte até 30% e margens separadas, livro das Eras (zip) e MessageHub (3 mensagens).
// SÓ com AVDP_DATA_DIR numa cópia do banco: grava "Em janela" e importa dados de teste.
// Uso: node tools/cdp.mjs tools/flow7.mjs <pasta-prints>   (ZIP=caminho do "Selos e Eras.zip")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async ({ main, shot, pages }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const st = (fn) => main.evaluate(fn)
  const results = []
  const check = (name, ok, info = '') => {
    results.push(ok)
    console.log(`${ok ? 'OK ' : 'FALHOU'} ${name}${info ? ` — ${info}` : ''}`)
  }
  await main.waitForFunction(() => window.__avdp && document.querySelector('.tabs'), null, { timeout: 60000 })
  const info = await inv('app_info')
  if (!/ClaudeTmp|scratchpad/i.test(info.data_dir)) throw new Error(`pasta de dados não é de teste: ${info.data_dir}`)
  // nunca projetar na TV: em janela
  await st(() => {
    const s = window.__avdp.getState()
    s.setModal(null)
    s.saveSettings({ monitor: null, autoOpenProjection: true })
  })

  // ---------- livro das Eras e Selos (zip) ----------
  if (process.env.ZIP) {
    const r = await inv('msg_import_books', { path: process.env.ZIP })
    check('Zip: 10 capítulos das Eras', r.eras_chapters === 10, JSON.stringify(r))
    check('Zip: Selos já estavam no banco (mesmo texto)', r.selos_same + r.selos_new === 10, `${r.selos_same} iguais, ${r.selos_new} novas`)
    const r2 = await inv('msg_import_books', { path: process.env.ZIP })
    const list = await inv('msg_list', { q: { filter: 'ERAS-', limit: 50, offset: 0 } })
    check('Reimportar não duplica', r2.eras_chapters === 10 && list.rows.filter((g) => g.code.startsWith('ERAS-')).length === 10, `${list.rows.length} grupos`)
  }

  // ---------- tema: tamanho até 30% e margens separadas ----------
  await st(() => {
    const s = window.__avdp.getState()
    s.setModal({ type: 'theme', theme: s.themes[0] })
  })
  await main.waitForSelector('.modal input[type=range]')
  const range = await main.evaluate(() => [...document.querySelectorAll('.modal label')].find((l) => l.textContent.trim().startsWith('Tamanho'))?.querySelector('input[type=range]')?.max)
  check('Tamanho da fonte vai até 30%', range === '30', range)
  const labels = await main.$$eval('.modal label', (ls) => ls.map((l) => l.textContent.trim()))
  check('Margens superior, inferior e laterais', ['Margem superior', 'Margem inferior', 'Margens laterais'].every((t) => labels.some((l) => l.startsWith(t))))
  await shot('01-tema')
  await st(() => window.__avdp.getState().setModal(null))

  // ---------- mensagem longa: prévia separada ----------
  await main.click('.tabs button:nth-child(3)')
  const grp = (await inv('msg_list', { q: { filter: 'ERAS-05', limit: 5, offset: 0 } })).rows[0] ?? (await inv('msg_list', { q: { filter: '63-0324N', limit: 5, offset: 0 } })).rows[0]
  // store do próprio app (no modo de teste); importar o módulo de novo daria outra cópia depois de uma edição (HMR)
  await main.evaluate((id) => window.__avdpMsg.getState().open(id), grp.id)
  await st(() => window.__avdp.getState().saveSettings({ msgView: 'paragrafos' }))
  await main.waitForFunction((code) => document.querySelector('.reader .center-title .code')?.textContent === code && document.querySelector('.reader-body .para p'), grp.code)
  await sleep(300)
  // parágrafo com mais de um slide
  const target = await main.evaluate(() => {
    const ps = [...document.querySelectorAll('.reader-body .para')]
    const i = ps.findIndex((p) => p.textContent.length > 900)
    return i
  })
  check('Achou parágrafo longo', target >= 0, `${grp.code} §idx ${target}`)
  const body = await main.$('.reader-body')
  await main.evaluate((i) => document.querySelectorAll('.reader-body .para')[i].scrollIntoView({ block: 'start' }), target)
  await sleep(200)
  const top0 = await body.evaluate((b) => b.scrollTop)
  const para = (await main.$$('.reader-body .para'))[target]
  const pbox = await (await para.$('p')).boundingBox()
  // clique perto do fim do parágrafo: a prévia vai para um pedaço depois do primeiro
  await main.mouse.click(pbox.x + pbox.width * 0.5, pbox.y + pbox.height - 8)
  await sleep(300)
  const top1 = await body.evaluate((b) => b.scrollTop)
  const s1 = await st(() => ({ live: !!window.__avdp.getState().live, cursor: window.__avdp.getState().cursor, label: window.__avdp.getState().item?.slides[window.__avdp.getState().cursor]?.label }))
  check('Clique no parágrafo não rola a tela', Math.abs(top1 - top0) < 2, `${top0} -> ${top1}`)
  check('Clique não projeta (só prévia)', !s1.live, JSON.stringify(s1))
  check('Clique no fim do parágrafo: prévia num pedaço depois do 1º', /\(\d+\/\d+\)/.test(s1.label ?? '') && !/\(1\//.test(s1.label ?? ''), s1.label)
  const prevText = await main.$eval('.preview-panel .live-what', (e) => e.textContent)
  check('Painel Prévia mostra o slide', prevText.includes(s1.label), prevText)
  await shot('02-previa')

  // Ctrl + duplo clique numa palavra do começo: projeta só o 1º pedaço
  await main.mouse.dblclick(pbox.x + 30, pbox.y + 10, { modifiers: ['Control'] })
  await sleep(500)
  const s2 = await st(() => {
    const s = window.__avdp.getState()
    return { live: s.live?.slides[s.liveIndex]?.label, cursor: s.cursor, liveIndex: s.liveIndex }
  })
  check('Ctrl+duplo clique projeta o pedaço da palavra', /\(1\//.test(s2.live ?? ''), JSON.stringify(s2))
  await sleep(600)
  const projOpen = await st(() => window.__avdp.getState().projectionOpen)
  check('Janela de projeção abriu (em janela)', projOpen)

  // prévia separada: escolher outro pedaço não mexe no ar
  await st(() => window.__avdp.getState().setCursor(window.__avdp.getState().liveIndex + 2))
  await sleep(200)
  const s3 = await st(() => ({ cursor: window.__avdp.getState().cursor, liveIndex: window.__avdp.getState().liveIndex }))
  check('Prévia e ao vivo separados', s3.cursor === s3.liveIndex + 2, JSON.stringify(s3))
  await main.keyboard.press('Enter')
  await sleep(300)
  const s4 = await st(() => ({ cursor: window.__avdp.getState().cursor, liveIndex: window.__avdp.getState().liveIndex }))
  check('Enter põe a prévia no ar', s4.liveIndex === s3.cursor, JSON.stringify(s4))
  await shot('03-ar-e-previa')

  // modo Slides
  await main.click('.center-head .seg button:nth-child(2)')
  await main.waitForSelector('.chunk')
  const chunks = await main.$$eval(`.reader-body .para[data-seq] .chunk`, (cs) => cs.length)
  check('Modo Slides mostra os pedaços', chunks > 0, `${chunks} pedaços na tela`)
  const lp = (await main.$$('.reader-body .para'))[target]
  const cks = await lp.$$('.chunk')
  check('Parágrafo longo dividido em pedaços', cks.length > 1, `${cks.length}`)
  await cks[1].click()
  await sleep(200)
  const s5 = await st(() => ({ cursor: window.__avdp.getState().cursor, live: window.__avdp.getState().liveIndex }))
  await cks[1].dblclick()
  await sleep(300)
  const s6 = await st(() => window.__avdp.getState().liveIndex)
  check('Slides: clique = prévia, duplo clique = projeta', s6 === s5.cursor && s5.live !== s5.cursor, `${JSON.stringify(s5)} -> ${s6}`)
  await shot('04-modo-slides')
  await main.click('.center-head .seg button:nth-child(1)')

  // ---------- Esc para de projetar ----------
  await main.keyboard.press('Escape')
  await sleep(1200)
  const s7 = await st(() => ({ live: !!window.__avdp.getState().live, open: window.__avdp.getState().projectionOpen }))
  const projPage = pages().some((p) => p.url().includes('projection'))
  check('Esc: nada no ar e janela de projeção fechada', !s7.live && !s7.open && !projPage, JSON.stringify(s7))

  // ---------- Bíblia: referência e clique vão para a prévia ----------
  await main.click('.tabs button:nth-child(2)')
  await main.waitForSelector('.bible-panel input.search')
  await main.fill('.bible-panel input.search', 'jo 3 16')
  await main.press('.bible-panel input.search', 'Enter')
  await sleep(900)
  const b1 = await st(() => {
    const s = window.__avdp.getState()
    return { live: !!s.live, prev: s.item?.slides[s.cursor]?.label, title: s.item?.title }
  })
  check('Referência digitada vai para a prévia (não projeta)', !b1.live && b1.prev === 'v. 16', JSON.stringify(b1))
  await main.keyboard.press('Enter')
  await sleep(500)
  const b2 = await st(() => window.__avdp.getState().live?.slides[window.__avdp.getState().liveIndex]?.label)
  check('Enter de novo projeta', b2 === 'v. 16', b2)
  const rows = await main.$$('.verse-row')
  await rows[2].click()
  await sleep(300)
  const b3 = await st(() => ({ live: window.__avdp.getState().live?.slides[window.__avdp.getState().liveIndex]?.label, prev: window.__avdp.getState().item?.slides[window.__avdp.getState().cursor]?.label }))
  check('Clique no versículo = prévia (ao vivo continua)', b3.live === 'v. 16' && b3.prev === 'v. 3', JSON.stringify(b3))
  await rows[2].dblclick()
  await sleep(400)
  const b4 = await st(() => window.__avdp.getState().live?.slides[window.__avdp.getState().liveIndex]?.label)
  check('Duplo clique no versículo projeta', b4 === 'v. 3', b4)
  await shot('05-biblia')
  await main.keyboard.press('Escape')
  await sleep(1000)

  // ---------- MessageHub: lista e 3 mensagens ----------
  if (!process.env.SEM_HUB) {
    const list = await inv('hub_list')
    check('MessageHub: lista completa', list.length >= 600, `${list.length} mensagens, ${list.filter((x) => x.need).length} para baixar`)
    const pick = ['55-0609', '64-0401', '63-0319'].map((c) => list.find((x) => x.code === c)).filter(Boolean)
    const out = await main.evaluate(async (items) => {
      const { pdfToText } = await import('/src/lib/importers.ts')
      const res = []
      for (const it of items) {
        const item = { tm_id: it.tm_id, code: it.code, title: it.title, title_en: it.title_en, local: it.local, updated: it.updated }
        const buf = await window.__TAURI_INTERNALS__.invoke('hub_pdf', { tmId: it.tm_id })
        const text = await pdfToText(buf)
        const n = await window.__TAURI_INTERNALS__.invoke('hub_save', { item, text })
        res.push({ code: it.code, n })
      }
      return res
    }, pick)
    check('MessageHub: 3 PDFs lidos e gravados', out.length === 3 && out.every((x) => x.n > 20), JSON.stringify(out))
    const hidden = await inv('hub_finish')
    const g = (await inv('msg_list', { q: { filter: '55-0609', limit: 5, offset: 0 } })).rows[0]
    const info = await inv('msg_group', { id: g.id })
    const hub = info.variants.find((v) => v.source === 'hub')
    const cbb = info.variants.find((v) => v.source === 'cbb')
    check('55-0609: tradução do MessageHub no grupo', !!hub && hub.para_count >= 50, `${hub?.para_count} §`)
    check('55-0609: cópia igual do CBB escondida', !!cbb && cbb.superseded_by === hub?.id, `cbb superseded_by=${cbb?.superseded_by} · ${hidden} escondidas no total`)
    const again = await inv('hub_list')
    check('MessageHub: baixadas não aparecem de novo para baixar', pick.every((p) => again.find((x) => x.tm_id === p.tm_id)?.need === false))
  }

  const ok = results.filter(Boolean).length
  console.log(`\n${ok}/${results.length} verificações OK`)
}
