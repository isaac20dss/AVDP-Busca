// Ponta a ponta da 4ª leva (bugs B1–B13, M9, Bi1/3/5/6/8/9/11/12, O2, O5) no app real.
// Seguro: usa "Em janela", cria uma música temporária e devolve configurações, favoritos e histórico no fim.
// Uso: node tools/cdp.mjs tools/flow3.mjs <pasta-de-prints>
import { restoreMarks, saveMarks } from './marks.mjs'

export default async ({ main, shot, pages }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const st = (fn) => main.evaluate(fn)
  const ok = []
  const bad = []
  const check = (name, cond, info = '') => {
    ;(cond ? ok : bad).push(`${name}${info ? ` — ${info}` : ''}`)
    console.log(cond ? 'OK  ' : 'FALHA', name, info)
  }
  const sleep = (ms) => main.waitForTimeout(ms)
  // recarrega a página para montar tudo com o código atual (a lista do dia é criada ao abrir)
  await main.reload()
  await main.waitForFunction(() => window.__avdp && document.querySelector('.tabs'), null, { timeout: 20000 })
  await sleep(1500)
  await main.keyboard.press('Escape')
  await st(() => window.__avdp.getState().setModal(null))

  // estado original para devolver no fim
  const orig = await st(() => {
    const s = window.__avdp.getState().settings
    return { monitor: s.monitor, stageMonitor: s.stageMonitor, bibleVersions: s.bibleVersions, bibleRangeMode: s.bibleRangeMode, bibleOnlyRef: s.bibleOnlyRef, bibleSplitLong: s.bibleSplitLong, bibleShowNextStart: s.bibleShowNextStart, bibleCycle: s.bibleCycle }
  })
  const marks = await saveMarks(main)
  await st(() => window.__avdp.getState().saveSettings({ monitor: null, stageMonitor: null }))
  let songId = 0
  try {
    // ---------- O5: lista do dia ----------
    const today = await st(() => {
      const d = new Date()
      return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase()}, ${d.toLocaleDateString('pt-BR')}`
    })
    const lists = await inv('playlists_list')
    const cur = await st(() => window.__avdp.getState().playlistId)
    check('O5 lista do dia existe e está aberta', lists.some((l) => l.name === today && l.id === cur), today)

    // ---------- letras: B1, B3, B4, B5 ----------
    songId = await inv('song_save', {
      song: { id: 0, title: 'Teste Gauntlet', artist: 'Autor Teste', author: '', note: 'Anotação de teste para o palco', lyrics: 'Primeira linha\nlinha um\n\nRefrão\nCoro aqui\nCoro dois\n\nTerceira linha\nlinha dois', paragraph_order: '', copyright: 'Domínio público', source: 'teste', theme_id: null, play_count: 0 },
    })
    await main.click('.tabs button:nth-child(1)')
    await main.fill('.panel input.search', 'Teste Gauntlet')
    await sleep(500)
    await main.click('.result-list li >> nth=0')
    await sleep(400)
    const labels = await st(() => window.__avdp.getState().item?.slides.map((s) => s.label))
    check('B5 estrofes numeradas 1, Refrão, 2', JSON.stringify(labels?.filter((l) => l !== 'Título')) === '["1","Refrão","2"]', JSON.stringify(labels))
    const footer = await st(() => window.__avdp.getState().item?.slides.find((s) => !s.title)?.footer)
    check('B3 letra tem rodapé (título · autor · copyright)', footer === 'Teste Gauntlet · Autor Teste · Domínio público', footer)
    const hint = await main.evaluate(() => document.querySelector('.center-empty .hint')?.textContent ?? '')
    await st(() => window.__avdp.getState().setCursor(1))
    await main.click('.slides-view .toolbar button:nth-child(2)')
    await sleep(300)
    const b1 = await st(() => ({ live: window.__avdp.getState().live?.title, idx: window.__avdp.getState().liveIndex }))
    check('B1 ⏭ fora do ar começa pelo selecionado (não pula)', b1.live === 'Teste Gauntlet' && b1.idx === 1, JSON.stringify(b1))
    await main.click('.slides-view .toolbar button:nth-child(2)')
    await sleep(200)
    check('B1 ⏭ no ar vai ao próximo', (await st(() => window.__avdp.getState().liveIndex)) === 2)
    void hint
    // B4: projetar de novo depois de outro item não soma de novo
    await main.click('.slide-card >> nth=0')
    await sleep(150)
    await st(() => window.__avdp.getState().endPresentation())
    await main.click('.slide-card >> nth=1')
    await sleep(300)
    const plays = (await inv('song_get', { id: songId })).play_count
    check('B4 "mais tocadas" conta 1 vez por dia', plays === 1, `play_count=${plays}`)
    // O2: tela de palco
    await st(async () => {
      await window.__TAURI_INTERNALS__.invoke('stage_open', { monitor: null })
      window.__avdp.getState().setStageOpen(true)
    })
    let stage
    for (let i = 0; i < 60 && !stage; i++) {
      stage = pages().find((p) => p.url().includes('#/stage'))
      if (!stage) await sleep(100)
    }
    await sleep(800)
    await st(() => window.__avdp.getState().sendStage())
    await sleep(300)
    const stageText = stage ? await stage.evaluate(() => document.body.innerText) : ''
    check('O2 palco mostra título, slide e próximo', !!stage && stageText.includes('Teste Gauntlet') && stageText.includes('A SEGUIR'), stageText.replace(/\s+/g, ' ').slice(0, 160))
    check('O2 palco mostra a anotação', stageText.includes('Anotação de teste'))
    if (stage) await shot('70-palco', stage)
    await main.click('.slides-view h1')
    await main.keyboard.press('F10')
    await sleep(400)
    const stageBlack = stage ? await stage.evaluate(() => document.body.innerText) : ''
    check('O2 palco mostra o estado da tela (F10 = TELA PRETA)', stageBlack.includes('TELA PRETA'))
    await main.keyboard.press('F10')
    await sleep(200)
    await st(async () => {
      await window.__TAURI_INTERNALS__.invoke('stage_close')
      window.__avdp.getState().setStageOpen(false)
    })
    // B11: música com tema próprio — o painel ao vivo mostra e troca o tema dela, sem mexer no tema de Letras
    const themes = await inv('themes_list')
    const own = themes[1]?.id
    const other = themes[2]?.id
    if (own && other) {
      const song = await inv('song_get', { id: songId })
      await inv('song_save', { song: { ...song, theme_id: own } })
      await main.fill('.panel input.search', 'Teste Gauntlet ')
      await sleep(500)
      await main.click('.result-list li >> nth=0')
      await sleep(300)
      await main.click('.slide-card >> nth=1')
      await sleep(300)
      const kindTheme = await st(() => window.__avdp.getState().settings.themeByKind.song)
      const shownTheme = await main.inputValue('.live-panel .theme-row select')
      await main.selectOption('.live-panel .theme-row select', String(other))
      await sleep(200)
      const after = await st(() => ({ live: window.__avdp.getState().live?.themeId, kind: window.__avdp.getState().settings.themeByKind.song }))
      check('B11 painel ao vivo mostra e troca o tema próprio da música', shownTheme === String(own) && after.live === other && after.kind === kindTheme, JSON.stringify({ shownTheme, ...after }))
      await st(() => window.__avdp.getState().endPresentation())
    }

    // B2: dica com os atalhos reais (tela vazia de Letras)
    await st(() => window.__avdp.getState().openItem && window.__avdp.setState({ item: null }))
    await sleep(150)
    const hint2 = await main.evaluate(() => document.querySelector('.center-empty .hint')?.textContent ?? '')
    check('B2 dica mostra F10 e Esc (não "B" nem "Espaço")', hint2.includes('F10') && hint2.includes('Esc') && !hint2.includes('Espaço'), hint2)
    await st(() => window.__avdp.getState().endPresentation())

    // ---------- Bíblia ----------
    await st(() => window.__avdp.getState().saveSettings({ bibleVersions: ['acf'], bibleRangeMode: 'sequencia', bibleOnlyRef: false, bibleSplitLong: false, bibleShowNextStart: false }))
    await main.click('.tabs button:nth-child(2)')
    await sleep(300)
    // 9ª leva: a referência digitada vai para a prévia; o segundo Enter projeta
    const typeRef = async (q) => {
      await main.fill('.bible-panel input.search', q)
      await main.keyboard.press('Enter')
      await sleep(700)
      await main.keyboard.press('Enter')
      await sleep(300)
    }
    await typeRef('1co 13:4-7')
    let live = await st(() => ({ t: window.__avdp.getState().live?.title, n: window.__avdp.getState().live?.slides.length }))
    check('B12/Bi1 trecho 1co 13:4-7 em sequência = 4 slides', live.t === '1 Coríntios 13:4-7' && live.n === 4, JSON.stringify(live))
    await st(() => window.__avdp.getState().saveSettings({ bibleRangeMode: 'juntos' }))
    await typeRef('1co 13:4-7')
    live = await st(() => ({ t: window.__avdp.getState().live?.title, n: window.__avdp.getState().live?.slides.length, refs: window.__avdp.getState().live?.slides[0]?.refs?.length, txt: window.__avdp.getState().live?.slides[0]?.text.slice(0, 40) }))
    check('Bi1 trecho juntos = 1 slide com 4 versículos', live.n === 1 && live.refs === 4, JSON.stringify(live))
    await shot('71-trecho-juntos')
    await main.click('.bible-center h1')
    await main.keyboard.press('ArrowRight')
    await sleep(300)
    const cont = await st(() => window.__avdp.getState().live?.slides[window.__avdp.getState().liveIndex]?.footer)
    check('Bi1 → depois do trecho continua no versículo seguinte', !!cont && cont.startsWith('1 Coríntios 13:8'), cont)
    // Bi12: Ctrl/Shift+clique
    await typeRef('jo 3')
    await main.click('.verse-row >> nth=15')
    await sleep(200)
    await main.click('.verse-row >> nth=17', { modifiers: ['Control'] })
    await sleep(150)
    const sel = await main.evaluate(() => document.querySelectorAll('.verse-row.picked').length)
    check('Bi12 Ctrl+clique escolhe versículos fora de sequência', sel === 2, `${sel} escolhidos`)
    await main.click('.bible-center .toolbar .primary')
    await sleep(300)
    live = await st(() => ({ t: window.__avdp.getState().live?.title }))
    check('Bi12 "Projetar" leva os versículos escolhidos', live.t === 'João 3:16, 18', JSON.stringify(live))
    await main.click('.verse-row >> nth=0', { modifiers: ['Shift'] })
    await sleep(150)
    check('Bi12 Shift+clique escolhe o trecho', (await main.evaluate(() => document.querySelectorAll('.verse-row.picked').length)) === 18)
    check('Bi12 Shift+clique não seleciona o texto da página', (await main.evaluate(() => String(window.getSelection()).trim().length)) === 0)
    // B10: lista guarda versão e trecho (e desfaz)
    await main.click('.bible-center .toolbar button:has-text("Lista")')
    await sleep(300)
    const plLast = await st(() => {
      const p = window.__avdp.getState().playlist
      return p[p.length - 1]
    })
    check('B10 item de Bíblia na lista guarda trecho e versão', plLast?.label === 'João 3:1-18 — ACF' && JSON.parse(plLast.ref).bible === 'acf', plLast?.label)
    await st(() => window.__avdp.getState().undoPlaylist())
    // B10: item guardado em NVI reabre em NVI mesmo com a ACF como principal
    await st(() => window.__avdp.getState().saveSettings({ bibleVersions: ['nvi'] }))
    await typeRef('rm 8 28')
    await main.click('.bible-center .toolbar button:has-text("Lista")')
    await sleep(300)
    await st(() => window.__avdp.getState().saveSettings({ bibleVersions: ['acf'] }))
    await sleep(300)
    await main.click('.playlist-items li >> nth=-1')
    await sleep(800)
    const reopened = await st(() => window.__avdp.getState().settings.bibleVersions[0])
    check('B10 item da lista reabre na versão guardada (NVI)', reopened === 'nvi', reopened)
    await st(() => {
      window.__avdp.getState().undoPlaylist()
      window.__avdp.getState().saveSettings({ bibleVersions: ['acf'] })
    })
    await sleep(300)
    await main.click('.tabs button:nth-child(2)')
    await typeRef('jo 3')
    await main.click('.verse-row >> nth=0')
    await main.click('.verse-row >> nth=17', { modifiers: ['Shift'] })
    // Bi3: favoritos e histórico
    const favBefore = await st(() => window.__avdp.getState().tab)
    void favBefore
    await main.click('.bible-center .toolbar button[title="Guardar nos favoritos"]')
    await sleep(200)
    await main.click('.bible-panel .subtabs button:has-text("Favoritos")')
    await sleep(200)
    const favs = await main.evaluate(() => [...document.querySelectorAll('.result-list.marks li .r-title')].map((e) => e.textContent))
    check('Bi3 favorito guardado', favs.some((f) => f.includes('João 3:1-18')), JSON.stringify(favs))
    await main.click('.bible-panel .subtabs button:has-text("Histórico")')
    await sleep(200)
    const hist = await main.evaluate(() => [...document.querySelectorAll('.result-list.marks li .r-title')].map((e) => e.textContent))
    check('Bi3 histórico tem o trecho e os versículos projetados', hist.some((h) => h.includes('1 Coríntios 13:4-7')) && hist.some((h) => h.includes('João 3:16, 18')), JSON.stringify(hist.slice(0, 4)))
    await shot('72-historico')
    await main.click('.bible-panel .subtabs button:has-text("Livros")')
    await st(() => window.__avdp.getState().endPresentation())
    // Bi5: só a referência
    await typeRef('jo 3 16')
    await main.click('.bible-center .toolbar button:has-text("Só ref.")')
    await sleep(300)
    const prev = await main.evaluate(() => document.querySelector('.preview-frame .stage-text')?.textContent)
    check('Bi5 só a referência na tela', prev === 'João 3:16', prev)
    await main.click('.bible-center .toolbar button:has-text("Só ref.")')
    // Bi11: dividir versículo longo + começo do próximo
    await st(() => window.__avdp.getState().saveSettings({ bibleSplitLong: true, bibleShowNextStart: true }))
    await typeRef('et 8')
    const split = await st(() => {
      // o último pedaço do v. 1 traz o começo do v. 2 (com letra grande o versículo se divide)
      const it = window.__avdp.getState().item
      return { slides: it?.slides.length, verses: new Set(it?.slides.map((s) => s.ref?.verse)).size, peek: it?.slides.find((s) => s.ref?.verse === 1 && s.peek)?.peek }
    })
    check('Bi11 versículo longo dividido (opção)', split.slides > split.verses, JSON.stringify(split))
    check('Bi11 começo do próximo versículo (opção)', typeof split.peek === 'string' && split.peek.startsWith('²'), split.peek)
    await st(() => window.__avdp.getState().saveSettings({ bibleSplitLong: false, bibleShowNextStart: false }))
    // Bi8: Ctrl+B só nas versões marcadas
    const seen = []
    for (let i = 0; i < 4; i++) {
      await main.click('.bible-center h1')
      await main.keyboard.press('Control+b')
      await sleep(250)
      seen.push(await st(() => window.__avdp.getState().settings.bibleVersions[0]))
    }
    check('Bi8 Ctrl+B passa só por ACF/KJA/NVI', seen.every((v) => ['acf', 'kja', 'nvi'].includes(v)) && new Set(seen).size === 3, seen.join(' → '))
    await main.click('.bible-center h1')
    await main.keyboard.press('Control+Alt+3')
    await sleep(250)
    const v3 = await st(() => window.__avdp.getState().settings.bibleVersions[0])
    check('Bi8 Ctrl+Alt+3 vai direto à 3ª versão', v3 === 'nvi', v3)
    // Bi6: reserva noutra língua não vai ao ar sozinha. Com ACF/NVI/KJA instaladas a reserva da BPM é em português;
    // para testar, esconde as três só na memória desta página (nada é apagado).
    await st(() => {
      const s = window.__avdp.getState()
      window.__keepBibles = s.bibles
      window.__avdp.setState({ bibles: s.bibles.filter((b) => !['acf', 'nvi', 'kja'].includes(b.id)) })
      s.saveSettings({ bibleVersions: ['porbrbsl'] })
      s.endPresentation()
    })
    await sleep(400)
    await typeRef('mc 1 1')
    const b6 = await st(() => ({ live: window.__avdp.getState().live?.title ?? null }))
    const banner = await main.evaluate(() => document.querySelector('.banner.fallback')?.textContent ?? '')
    check('Bi6 reserva noutra língua espera confirmação', b6.live === null && banner.includes('mesmo assim'), banner.slice(0, 140))
    await main.click('.banner.fallback button')
    await sleep(300)
    const b6b = await st(() => window.__avdp.getState().live?.slides[window.__avdp.getState().liveIndex]?.footer ?? null)
    check('Bi6 "mesmo assim" projeta a reserva', !!b6b && b6b.startsWith('Marcos 1:1'), b6b)
    await st(() => {
      window.__avdp.setState({ bibles: window.__keepBibles })
      window.__avdp.getState().saveSettings({ bibleVersions: ['acf'] })
      window.__avdp.getState().endPresentation()
    })
    await sleep(400)
    // B9/B13/Bi9: pesquisa (a 1ª pesquisa depois de abrir carrega o vocabulário; aquece antes de medir)
    await inv('bible_search', { q: { query: 'luz', opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10 }, bible: 'acf', scope: 'all', book: 1, limit: 1, offset: 0, sort: '' } })
    const t0 = Date.now()
    const ot = await inv('bible_search', { q: { query: 'pastor', opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10 }, bible: 'acf', scope: 'ot', book: 43, limit: 3, offset: 0, sort: '' } })
    const otMs = Date.now() - t0
    check('B9 pesquisa só AT rápida', otMs < 300, `${otMs} ms, ${ot.total} versículos`)
    const ord = await inv('bible_search', { q: { query: 'no princípio', opts: { mode: 'exact', whole_word: true, variants: false, fuzzy: false, near: 10 }, bible: 'acf', scope: 'all', book: 1, limit: 2, offset: 0, sort: 'bible' } })
    check('Bi9 ordem bíblica começa em Gênesis 1:1', ord.hits[0]?.reference === 'Gênesis 1:1', ord.hits[0]?.reference)
    await main.fill('.bible-panel input.search', 'senhor')
    await main.keyboard.press('Enter')
    await sleep(900)
    const more = await main.evaluate(() => document.querySelector('.bible-search .result-list li.more')?.textContent ?? '')
    check('B13 pesquisa grande mostra "Mostrar mais"', /Mostrar mais \(\d+/.test(more), more)
    await main.click('.bible-panel .subtabs button:has-text("Livros")')

    // ---------- mensagens ----------
    await main.click('.tabs button:nth-child(3)')
    await sleep(300)
    await main.click('.subtabs.top button:has-text("Pesquisar")')
    await main.click('.msg-panel input.search')
    await main.fill('.msg-panel input.search', 'arreb')
    await sleep(700)
    const ta = await main.evaluate(() => [...document.querySelectorAll('.typeahead li')].map((l) => l.textContent))
    check('M9 sugestões ao digitar (palavras e títulos)', ta.some((t) => t.includes('arrebatamento')) && ta.some((t) => t.includes('O Arrebatamento')), JSON.stringify(ta.slice(0, 3)))
    await shot('73-sugestoes')
    await main.keyboard.press('ArrowDown')
    await main.keyboard.press('Enter')
    await sleep(300)
    const q = await main.inputValue('.msg-panel input.search')
    check('M9 Enter completa a palavra', q === 'arrebatamento ', JSON.stringify(q))
    await main.keyboard.press('Escape')
    const s1 = await inv('msg_suggest', { input: 'pilar de f' })
    const s2 = await inv('msg_suggest', { input: '65-11' })
    check('M9 sugere com a última palavra de 1 letra', s1.terms.some((t) => t.word.startsWith('f')), s1.terms.slice(0, 3).map((t) => t.word).join(', '))
    check('M9 sugere mensagens por código começado (65-11)', s2.titles.length > 0 && s2.titles.every((g) => g.code.startsWith('65-11')), s2.titles.slice(0, 3).map((g) => g.code).join(', '))
    // B8: frase destacada inteira no leitor
    await main.fill('.msg-panel input.search', '"sétimo selo"')
    await sleep(1000)
    await main.click('.msg-results li:not(.direct) >> nth=0')
    await sleep(1000)
    const marks = await main.evaluate(() => [...document.querySelectorAll('.reader mark, .reader-body mark')].map((m) => m.textContent))
    const soltas = marks.filter((m) => /^selos?$/i.test(m.trim()))
    check('B8 leitor destaca a frase, não "Selo(s)" solto', marks.length > 0 && soltas.length === 0, `${marks.length} destaques, ${soltas.length} soltos: ${JSON.stringify(marks.slice(0, 3))}`)
    // B6/B7: curinga no meio, XOR, peso; e ordem por título
    const ms = (query, extra = {}) =>
      inv('msg_search', { q: { query, opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10 }, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 2, offset: 0, ...extra } })
    const w = await ms('pro?eta')
    check('B6 curinga no meio não vira prefixo', w.total > 0 && w.total < 20000 && w.terms.every((t) => /^pro.eta$/.test(t)), `${w.total} | ${w.terms.join(',')}`)
    const x = await ms('fé XOR obras')
    const both = await ms('fé obras')
    const any = await ms('fé OU obras')
    check('B7 XOR = (fé OU obras) − (fé E obras)', x.total === any.total - both.total && x.total > 0, `${x.total} = ${any.total} − ${both.total}`)
    const bo = await ms('graça^3 fé')
    check('B7 peso ^3 acha resultados', bo.total > 0, `${bo.total}`)
    const anyQ = (q) =>
      inv('msg_search', { q: { query: q, opts: { mode: 'any', whole_word: true, variants: false, fuzzy: false, near: 10 }, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 10, offset: 0 } })
    // conta quantas vezes "fé" aparece destacado nos 10 primeiros, sem e com o peso
    const countFe = (r) => r.hits.reduce((n, h) => n + (h.marked.match(/⟦fé/gi) || []).length, 0)
    const plain = countFe(await anyQ('graça fé'))
    const boosted = countFe(await anyQ('graça fé^5'))
    check('B7 peso ^5 puxa o termo para o topo', boosted > plain, `"fé" destacado no top 10: ${plain} → ${boosted}`)
    const so = await ms('pilar de fogo', { sort: 'title' })
    check('ordem por título no modo parágrafo', so.total > 0)
  } finally {
    await st(async () => {
      const s = window.__avdp.getState()
      s.endPresentation()
      await window.__TAURI_INTERNALS__.invoke('projection_close').catch(() => {})
      await window.__TAURI_INTERNALS__.invoke('stage_close').catch(() => {})
      s.setProjectionOpen(false)
      s.setStageOpen(false)
    })
    if (songId) await inv('song_delete', { id: songId })
    // favoritos e histórico voltam ao que eram
    await restoreMarks(main, marks)
    await main.evaluate((o) => window.__avdp.getState().saveSettings(o), orig)
    console.log(`\n${ok.length} ok, ${bad.length} falhas`)
    if (bad.length) console.log('FALHAS:\n' + bad.join('\n'))
  }
}
