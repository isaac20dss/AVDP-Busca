// 15ª leva: Selos/Eras na pesquisa de mensagens, livro escolhido na pesquisa da Bíblia,
// trecho (começo e fim escolhidos) no leitor e sem a dica ao passar o mouse nos slides.
// Usa uma CÓPIA do banco (AVDP_DATA_DIR): grava "Em janela" para não projetar na TV.
// Uso: node tools/cdp.mjs tools/flow14.mjs shots/flow14
let ok = 0
let bad = 0
const check = (name, cond, extra = '') => {
  if (cond) ok++
  else bad++
  console.log(`${cond ? 'OK  ' : 'FALHA'} ${name}${extra ? ` — ${extra}` : ''}`)
}
const SELOS = ['63-0317M', '63-0317N', '63-0318', '63-0319', '63-0320', '63-0321', '63-0322', '63-0323', '63-0324M', '63-0324N']

export default async ({ main, shot }) => {
  const s = () => main.evaluate(() => window.__avdp.getState())
  await main.evaluate(() => window.__avdp.getState().saveSettings({ monitor: null }))
  const inv = (cmd, args) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])

  // 1. comando: coleção na pesquisa
  const base = { query: 'selo', opts: { mode: 'all', whole_word: false, variations: false, fuzzy: false, near: 10 }, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: true, limit: 200, offset: 0 }
  const all = await inv('msg_search', { q: { ...base, collection: '' } })
  const se = await inv('msg_search', { q: { ...base, collection: 'selos' } })
  const er = await inv('msg_search', { q: { ...base, collection: 'eras' } })
  check('pesquisa sem coleção', all.total > se.total, `${all.total} mensagens`)
  check('só Selos', se.total > 0 && se.hits.every((h) => SELOS.includes(h.code)) && se.direct.every((g) => SELOS.includes(g.code)), `${se.total}: ${[...new Set(se.hits.map((h) => h.code))].join(' ')}`)
  check('só Eras', er.total > 0 && er.hits.every((h) => h.code.startsWith('ERAS-')) && er.direct.every((g) => g.code.startsWith('ERAS-')), `${er.total}: ${[...new Set(er.hits.map((h) => h.code))].join(' ')}`)

  // 2. tela: botões Selos/Eras na aba Pesquisar
  await main.evaluate(() => window.__avdp.getState().setTab('mensagens'))
  await main.waitForTimeout(400)
  await main.click('.msg-panel .subtabs button:has-text("Pesquisar")')
  await main.fill('.msg-panel input.search', 'selo')
  await main.press('.msg-panel input.search', 'Escape')
  await main.waitForTimeout(1200)
  const codes = () => main.$$eval('.msg-results li .code', (els) => els.map((e) => e.textContent.trim()))
  const before = await codes()
  await main.click('.msg-panel .collections button:has-text("Selos")')
  await main.waitForTimeout(1200)
  const afterSelos = await codes()
  check('botão Selos na pesquisa', afterSelos.length > 0 && afterSelos.every((c) => SELOS.includes(c)), `${before.length} → ${afterSelos.length}`)
  await shot('1-pesquisa-selos')
  await main.click('.msg-panel .collections button:has-text("Eras")')
  await main.waitForTimeout(1200)
  const afterEras = await codes()
  check('botão Eras na pesquisa', afterEras.length > 0 && afterEras.every((c) => c.startsWith('ERAS-')), `${afterEras.length}`)
  await shot('2-pesquisa-eras')
  await main.click('.msg-panel .collections button:has-text("Eras")')
  await main.waitForTimeout(1200)
  check('desligar volta a todas', (await codes()).length >= afterEras.length && (await codes()).some((c) => !c.startsWith('ERAS-')))

  // 3. Bíblia: escolher o livro da pesquisa
  await main.evaluate(() => window.__avdp.getState().setTab('biblia'))
  await main.waitForTimeout(500)
  const bin = main.locator('.panel input').first()
  await bin.fill('amor')
  await bin.press('Enter')
  await main.waitForTimeout(1200)
  const sel = main.locator('select[aria-label="Livro da pesquisa"]')
  check('lista de livros na pesquisa', (await sel.count()) === 1)
  await sel.selectOption('43')
  await main.waitForTimeout(1200)
  const refs = await main.$$eval('.result-list li', (els) => els.map((e) => e.textContent.trim().slice(0, 40)))
  const scopeOn = await main.$eval('select[aria-label="Livro da pesquisa"]', (e) => e.parentElement.querySelector('input').checked)
  check('pesquisa só em João', refs.length > 0 && refs.every((r) => /^Jo(ão)?\s/.test(r)) && scopeOn, `${refs.length}: ${refs.slice(0, 3).join(' | ')}`)
  await shot('3-biblia-livro')

  // 4. trecho no leitor
  await main.evaluate(() => window.__avdp.getState().setTab('mensagens'))
  const gid = (await inv('msg_list', { q: { filter: '63-0318', only_with_text: true, sort: 'date', limit: 5, offset: 0, collection: '' } })).rows[0]?.id
  await main.evaluate((id) => window.__avdpMsg.getState().open(id), gid)
  await main.waitForTimeout(1500)
  const view0 = (await s()).settings.msgView
  // sem dica ao passar o mouse nos slides e nos parágrafos
  await main.evaluate(() => window.__avdp.getState().saveSettings({ msgView: 'slides' }))
  await main.waitForTimeout(800)
  check('slides sem dica (title)', await main.$$eval('.chunk', (els) => els.length > 0 && els.every((e) => !e.title)))
  await main.click('.toolbar button:has-text("Trecho")')
  await main.waitForTimeout(800)
  check('Trecho volta para Parágrafos', (await s()).settings.msgView === 'paragrafos')
  check('parágrafos sem dica (title)', await main.$$eval('.reader-body .para', (els) => els.every((e) => !e.title)))
  // um parágrafo longo na tela: começo na 6ª palavra, fim na 25ª
  const pos = await main.evaluate(() => {
    const body = document.querySelector('.reader-body')
    const r0 = body.getBoundingClientRect()
    const para = [...body.querySelectorAll('.para')].find((d) => {
      const r = d.getBoundingClientRect()
      return r.top > r0.top && r.bottom < r0.bottom && d.querySelector('p').textContent.split(/\s+/).length > 40
    })
    if (!para) return null
    const p = para.querySelector('p')
    const text = p.textContent
    const words = [...text.matchAll(/\S+/g)]
    const at = (k) => {
      const node = p.firstChild
      const rg = document.createRange()
      rg.setStart(node, words[k].index + 1)
      rg.setEnd(node, words[k].index + 2)
      const b = rg.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    }
    return { a: at(5), b: at(24), first: words[5][0], last: words[24][0], seq: +para.dataset.seq }
  })
  check('achou parágrafo longo', !!pos)
  await main.mouse.click(pos.a.x, pos.a.y)
  await main.waitForTimeout(300)
  const bar1 = await main.$eval('.trecho-bar', (e) => e.textContent)
  check('pede o fim', bar1.includes('termina'), bar1)
  await main.mouse.click(pos.b.x, pos.b.y)
  await main.waitForTimeout(400)
  const bar2 = await main.$eval('.trecho-bar', (e) => e.textContent)
  const marked = await main.$eval('.para .trecho', (e) => e.textContent)
  check('trecho marcado da palavra 6 à 25', marked.startsWith(pos.first) && marked.trim().endsWith(pos.last), `“${marked.slice(0, 40)}…${marked.slice(-30)}”`)
  check('barra mostra o trecho', bar2.includes('Projetar trecho') && bar2.includes(pos.first), bar2)
  await shot('4-trecho-escolhido')
  const liveBefore = (await s()).live?.key
  await main.click('.trecho-bar button:has-text("Projetar trecho")')
  await main.waitForTimeout(800)
  const st = await s()
  const slideText = st.live?.slides.map((x) => x.text).join(' ') ?? ''
  check('no ar só o trecho', st.live?.key.includes(':trecho:') && slideText.startsWith(pos.first) && slideText.trim().endsWith(pos.last), `${st.live?.slides.length} slide(s): “${slideText.slice(0, 50)}…”`)
  check('rodapé da mensagem', /63-0318/.test(st.live?.slides[0]?.footer ?? ''), st.live?.slides[0]?.footer)
  await shot('5-trecho-no-ar')
  // fim antes do começo: inverte sozinho
  await main.click('.trecho-bar button:has-text("Limpar")')
  await main.click('.toolbar button:has-text("Trecho")')
  await main.mouse.click(pos.b.x, pos.b.y)
  await main.mouse.click(pos.a.x, pos.a.y)
  await main.waitForTimeout(400)
  const marked2 = await main.$eval('.para .trecho', (e) => e.textContent)
  check('clicar o fim primeiro também vale', marked2 === marked)
  await main.click('.trecho-bar button:has-text("Limpar")')
  check('Limpar tira a barra', (await main.$$('.trecho-bar')).length === 0)
  // clique normal continua pondo na prévia
  await main.mouse.click(pos.a.x, pos.a.y)
  await main.waitForTimeout(300)
  check('clique normal = prévia', (await main.evaluate(() => window.__avdpMsg.getState().focusSeq)) === pos.seq)

  // fim: tira do ar, devolve visualização
  await main.evaluate(() => window.__avdp.getState().endPresentation())
  await main.evaluate((v) => window.__avdp.getState().saveSettings({ msgView: v }), view0)
  console.log(`\n${ok} ok, ${bad} falha(s); ao vivo antes: ${liveBefore ?? 'nada'}`)
}
