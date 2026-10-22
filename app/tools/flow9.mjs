// 10ª leva: tamanho digitado, número do § fora do texto, tolerância (pedaço curto junto do vizinho),
// modelo do rodapé e edição de mensagens (corrigir, juntar, desfazer).
// SÓ com AVDP_DATA_DIR numa cópia do banco: edita uma mensagem e desfaz no fim.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async ({ main, shot }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const st = (fn, arg) => main.evaluate(fn, arg)
  const results = []
  const check = (name, ok, info = '') => {
    results.push(ok)
    console.log(`${ok ? 'OK ' : 'FALHOU'} ${name}${info ? ` — ${info}` : ''}`)
  }
  await main.waitForFunction(() => window.__avdp && window.__avdpMsg && document.querySelector('.tabs'), null, { timeout: 60000 })
  const info = await inv('app_info')
  if (!/ClaudeTmp|scratchpad/i.test(info.data_dir)) throw new Error(`pasta de dados não é de teste: ${info.data_dir}`)
  await st(() => {
    const s = window.__avdp.getState()
    s.setModal(null)
    s.saveSettings({ monitor: null, msgView: 'paragrafos', msgFooter: '{codigo} · {titulo} · §{num}' })
  })

  // ---------- tema: tamanho digitado ----------
  await st(() => {
    const s = window.__avdp.getState()
    s.setModal({ type: 'theme', theme: s.themes[0] })
  })
  await main.waitForSelector('.modal .size-row input[type=number]')
  await main.fill('.modal .size-row input[type=number]', '21')
  await sleep(200)
  const range = await main.$eval('.modal .size-row input[type=range]', (e) => e.value)
  check('Tamanho digitado (21%) move o controle', range === '21', range)
  const fitTxt = await main.$eval('.modal .fit-row', (e) => e.textContent)
  check('Tema mostra quanto cabe e a tolerância automática', /cabem até \d+/.test(fitTxt) && /automático/.test(fitTxt), fitTxt.slice(0, 160))
  await shot('30-tema')
  await st(() => window.__avdp.getState().setModal(null))

  // ---------- mensagem com número no texto ("Fé é a substância", Busca CBB) ----------
  await main.click('.tabs button:nth-child(3)')
  const g = (await inv('msg_list', { q: { filter: 'substancia', limit: 20, offset: 0 } })).rows.find((r) => r.code.startsWith('47-'))
  const grp = await inv('msg_group', { id: g.id })
  const v = grp.variants.find((x) => x.source === 'cbb' && x.para_count > 100) ?? grp.variants.find((x) => x.para_count > 0)
  await st(([gid, vid]) => window.__avdpMsg.getState().open(gid, vid), [g.id, v.id])
  await main.waitForFunction((code) => document.querySelector('.reader .center-title .code')?.textContent === code, g.code)
  await sleep(400)
  const raw = await inv('msg_paragraphs', { variantId: v.id })
  const withNum = raw.filter((p) => {
    const m = p.text.match(/^\s*(\d{1,4})\s*[.)]/)
    return p.num > 0 && m && +m[1] <= p.num && +m[1] >= p.num - 40
  }).length
  // número no começo do texto igual ao do § ou deslocado até 40 atrás (numeração do site fora do lugar)
  const shown = await st(() =>
    window.__avdpMsg.getState().paras.filter((p) => {
      const m = p.text.match(/^\s*(\d{1,4})\s*[.)]/)
      return p.num > 0 && m && +m[1] <= p.num && +m[1] >= p.num - 40
    }).length,
  )
  check('Número do § sai do texto (fica só no rodapé)', withNum > 0 && shown === 0, `${withNum} no banco, ${shown} na tela`)
  const slides = await st(() => window.__avdp.getState().item.slides)
  check('Nenhum slide só com o número ("3.")', !slides.some((s) => /^\d{1,4}\.?$/.test(s.text.trim())))
  const merge = await main.evaluate(async () => (await import('/src/lib/fit.ts')).mergeFor('message'))
  const short = slides.filter((s, i) => /\(\d+\/\d+\)/.test(s.label) && s.text.length < merge)
  check('Tolerância: nenhum pedaço curto sozinho', short.length === 0, `tolerância ${merge}; curtos: ${short.slice(0, 3).map((s) => s.label + ' ' + s.text).join(' | ')}`)

  // ---------- rodapé pelo modelo ----------
  await st(() => window.__avdp.getState().saveSettings({ msgFooter: '{codigo} · ¶{num}' }))
  await sleep(500)
  const f1 = await st(() => window.__avdp.getState().item.slides.find((s) => s.label.startsWith('§2'))?.footer)
  check('Rodapé segue o modelo ({codigo} · ¶{num})', f1 === `${g.code} · ¶2`, f1)
  await st(() => window.__avdp.getState().saveSettings({ msgFooter: '{codigo} · {titulo} · §{num}' }))

  // ---------- edição ----------
  await main.click('.reader .toolbar button:has-text("Editar")')
  await sleep(200)
  const target = await st(() => window.__avdpMsg.getState().paras[3])
  await main.click(`.reader-body .para[data-seq="${target.seq}"]`)
  await main.waitForSelector('.para-edit textarea')
  await main.fill('.para-edit textarea', `${target.text} palavrateste`)
  await main.keyboard.press('Control+Enter')
  await sleep(800)
  const after = await st((seq) => window.__avdpMsg.getState().paras.find((p) => p.seq === seq)?.text, target.seq)
  check('Corrigir texto do parágrafo', after?.endsWith('palavrateste'), after?.slice(-40))
  const found = await inv('msg_search', { q: { query: 'palavrateste', opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10 }, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 10, offset: 0 } })
  check('Pesquisa acha o texto corrigido', found.total === 1, `${found.total}`)
  const g2 = await inv('msg_group', { id: g.id })
  check('Tradução marcada como editada', g2.variants.find((x) => x.id === v.id)?.edited === true)
  const banner = await main.evaluate(() => document.querySelector('.banner.edit')?.textContent ?? '')
  check('Aviso com "Desfazer correções"', banner.includes('Desfazer'), banner.slice(0, 120))
  // juntar com o seguinte
  const n0 = await st(() => window.__avdpMsg.getState().paras.length)
  const p4 = await st(() => window.__avdpMsg.getState().paras[4])
  const p5 = await st(() => window.__avdpMsg.getState().paras[5])
  await main.click(`.reader-body .para[data-seq="${p4.seq}"]`)
  await main.waitForSelector('.para-edit textarea')
  await main.click('.para-edit button:has-text("Juntar com o seguinte")')
  await sleep(800)
  const joined = await st((seq) => window.__avdpMsg.getState().paras.find((p) => p.seq === seq)?.text, p4.seq)
  const n1 = await st(() => window.__avdpMsg.getState().paras.length)
  check('Juntar com o seguinte', n1 === n0 - 1 && joined?.endsWith(p5.text.slice(-20)), `${n0} -> ${n1}`)
  await shot('31-edicao')
  // desfazer (a janela de confirmação é trocada só neste teste)
  await st(() => {
    window.confirm = () => true
  })
  await main.click('.banner.edit button:has-text("Desfazer")')
  await sleep(900)
  const back = await inv('msg_paragraphs', { variantId: v.id })
  check('Desfazer volta ao texto original', back.length === raw.length && back.every((p, i) => p.text === raw[i].text), `${back.length}/${raw.length}`)
  const g3 = await inv('msg_group', { id: g.id })
  check('Depois de desfazer não está mais editada', !g3.variants.find((x) => x.id === v.id)?.edited)
  await main.click('.reader .toolbar button:has-text("Editando")')

  const ok = results.filter(Boolean).length
  console.log(`\n${ok}/${results.length} verificações OK`)
}
