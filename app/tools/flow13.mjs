// 14ª leva (versão 1.5.0): aba Textos no modo Holyrics, referência bíblica inteira no slide,
// Parágrafos ⇄ Slides mantendo o parágrafo no centro, tamanho da letra digitado e fontes de fora.
// Só lê o banco: não salva tema, não projeta; devolve a visualização das mensagens no fim.
// Uso: node tools/cdp.mjs tools/flow13.mjs shots/flow13
let ok = 0
let bad = 0
const check = (name, cond, extra = '') => {
  if (cond) ok++
  else bad++
  console.log(`${cond ? 'OK  ' : 'FALHA'} ${name}${extra ? ` — ${extra}` : ''}`)
}

export default async ({ main, shot }) => {
  const s = () => main.evaluate(() => window.__avdp.getState())
  const msgView0 = await main.evaluate(() => window.__avdp.getState().settings.msgView)

  // 1. aba Textos no modo Holyrics
  const tabs = await main.$$eval('nav.tabs button', (bs) => bs.map((b) => b.textContent.trim()))
  check('modo Holyrics', (await s()).holyricsMode)
  check('aba Textos na barra', tabs.some((t) => t.includes('Textos')), tabs.join(' | '))
  await main.evaluate(() => window.__avdp.getState().setTab('textos'))
  check('setTab textos aceito', (await s()).tab === 'textos')
  await shot('1-textos')

  // 2. Era de Esmirna: "Is. 54:13" e "Mat. 16:17" não partem
  await main.evaluate(() => window.__avdp.getState().setTab('mensagens'))
  const gid = await main.evaluate(async () => {
    const inv = window.__TAURI_INTERNALS__.invoke
    const r = await inv('msg_list', { q: { filter: 'Esmirna', year_from: null, year_to: null, only_with_text: false, only_multi: false, sort: '', limit: 20, offset: 0, ids: [], collection: '' } })
    const rows = r.rows ?? r
    return (rows.find((x) => /ERAS-04/.test(x.code)) ?? rows[0])?.id ?? null
  })
  check('achou a Era de Esmirna', gid != null)
  await main.evaluate((id) => window.__avdpMsg.getState().open(id), gid)
  await main.waitForTimeout(1500)
  const slides = await main.evaluate(() => window.__avdp.getState().item?.slides.map((x) => x.text) ?? [])
  const cut = []
  for (let i = 0; i + 1 < slides.length; i++) {
    const a = slides[i]
    const b = slides[i + 1]
    // fim do slide = abreviação de livro e o próximo começa com capítulo:versículo
    if (/\b\p{Lu}\p{Ll}{0,5}\.$/u.test(a) && /^\d{1,3}:\d/.test(b)) cut.push(`${a.slice(-20)} | ${b.slice(0, 20)}`)
    if (/\p{L}$/u.test(a) && /^\d{1,3}:\d/.test(b)) cut.push(`${a.slice(-20)} | ${b.slice(0, 20)}`)
  }
  check('nenhuma referência partida entre slides', cut.length === 0, cut.slice(0, 3).join(' ; ') || `${slides.length} slides`)
  const is54 = slides.find((t) => t.includes('Is. 54:13'))
  check('"Is. 54:13" inteiro num slide', !!is54)
  const mat = slides.find((t) => /Mat\. 16:17/.test(t))
  check('"Mat. 16:17" inteiro num slide', !!mat)

  // 3. Parágrafos ⇄ Slides: o parágrafo do centro continua no centro
  await main.evaluate(() => window.__avdp.getState().saveSettings({ msgView: 'paragrafos' }))
  await main.waitForTimeout(300)
  const seqIs = await main.evaluate(() => {
    const p = window.__avdpMsg.getState().paras.find((x) => x.text.includes('Is. 54:13'))
    return p?.seq ?? null
  })
  const centered = () =>
    main.evaluate(() => {
      const body = document.querySelector('.reader [data-seq]')?.parentElement
      const scroller = body?.closest('.reader-body') ?? body
      const r = (scroller ?? document.body).getBoundingClientRect()
      const mid = r.top + r.height / 2
      const el = [...document.querySelectorAll('.reader [data-seq]')].find((e) => {
        const b = e.getBoundingClientRect()
        return b.top <= mid && b.bottom >= mid
      })
      return el ? +el.dataset.seq : null
    })
  // tira o foco do parágrafo selecionado (vale o do centro da tela) e rola até o "Is. 54:13"
  await main.evaluate(() => window.__avdpMsg.setState({ focusSeq: null }))
  await main.waitForTimeout(300)
  await main.evaluate((seq) => document.querySelector(`.reader [data-seq="${seq}"]`)?.scrollIntoView({ block: 'center' }), seqIs)
  await main.waitForTimeout(300)
  const before = await centered()
  await main.click('.seg button:has-text("Slides")')
  await main.waitForTimeout(500)
  const afterSlides = await centered()
  await shot('3-slides-centro')
  await main.click('.seg button:has-text("Parágrafos")')
  await main.waitForTimeout(500)
  const afterParas = await centered()
  check('Slides mantém o parágrafo do centro', before === seqIs && afterSlides === before, `Is. 54:13 = ${seqIs}, antes ${before}, depois ${afterSlides}`)
  check('Parágrafos mantém o parágrafo do centro', afterParas === before, `depois ${afterParas}`)

  // 4. editor de tema: tamanho digitado só vale ao sair da caixa; lista de fontes
  await main.evaluate(() => {
    const st = window.__avdp.getState()
    st.setModal({ type: 'theme', theme: st.themes[0] })
  })
  await main.waitForTimeout(800)
  const input = main.locator('input[aria-label="Tamanho da letra em porcentagem"]')
  const range = main.locator('.size-row input[type=range]')
  const size0 = await range.inputValue()
  await input.fill('')
  await input.pressSequentially('15')
  check('digitando "15" não muda antes de sair', (await range.inputValue()) === size0 && (await input.inputValue()) === '15')
  await input.press('Tab')
  check('ao sair da caixa vale 15', (await range.inputValue()) === '15', await range.inputValue())
  await input.fill('')
  await input.pressSequentially('45')
  await input.press('Enter')
  check('acima de 30 vira 30', (await range.inputValue()) === '30')
  await main.waitForTimeout(3000)
  const groups = await main.$$eval('.theme-editor select optgroup', (gs) => gs.map((g) => `${g.label}:${g.children.length}`))
  check('fontes do app e instaladas no computador', groups.some((g) => g.startsWith('Instaladas no computador')), groups.join(' | '))
  await main.selectOption('.theme-editor select', 'Comic Sans MS').catch(() => {})
  await main.waitForTimeout(300)
  const fam = await main.$eval('.theme-preview .slide-text, .theme-preview [style*="font-family"]', (e) => getComputedStyle(e).fontFamily).catch(() => '')
  check('prévia usa fonte instalada', /Comic Sans MS/.test(fam), fam)
  await shot('4-tema')

  // fonte importada de arquivo (Montserrat da pasta fontes/ com outro nome? usa a própria) — importa e tira
  const imp = await main.evaluate(async () => {
    const inv = window.__TAURI_INTERNALS__.invoke
    const path = 'C:\\Users\\Isaac\\Documents\\Claude\\AVDP\\AVDP Busca\\fontes\\RobotoSlab-700.ttf'
    const f = await inv('font_import', { path })
    const list = await inv('fonts_list', { system: false })
    const bytes = await inv('font_bytes', { file: f.file })
    const face = new FontFace('Teste Importada', bytes, { weight: '700' })
    await face.load()
    await inv('font_remove', { file: f.file })
    const after = await inv('fonts_list', { system: false })
    return { f, n: list.custom.length, size: bytes.byteLength, loaded: face.status, after: after.custom.length }
  })
  check('importar fonte lê família e peso', imp.f.family === 'Roboto Slab' && imp.f.weight === 700, JSON.stringify(imp.f))
  check('bytes da fonte viram FontFace', imp.size > 10000 && imp.loaded === 'loaded', `${imp.size} bytes`)
  check('remover tira da lista', imp.after === imp.n - 1)

  // fecha sem salvar e devolve a visualização
  await main.evaluate(() => window.__avdp.getState().setModal(null))
  await main.evaluate((v) => window.__avdp.getState().saveSettings({ msgView: v }), msgView0)
  console.log(`\n${ok} ok, ${bad} falha(s)`)
}
