// Prints e casos de função para o crítico do gauntlet, sempre do mesmo estado, com carimbo da rodada.
// Uso: GAUNTLET_ROUND=2 node tools/cdp.mjs tools/gauntlet-capture.mjs <dir>
// Nunca projeta na TV: troca o monitor para "Em janela" durante a captura e devolve o valor original no fim.
import fs from 'node:fs'
import { restoreMarks, saveMarks } from './marks.mjs'

export default async ({ main, shot }) => {
  const round = process.env.GAUNTLET_ROUND ?? '0'
  const stamp = `R${round} ${new Date().toISOString().slice(11, 16)}`
  const outDir = process.argv[3]
  const setStamp = () =>
    main.evaluate((t) => {
      let el = document.getElementById('gauntlet-stamp')
      if (!el) {
        el = document.createElement('div')
        el.id = 'gauntlet-stamp'
        el.style.cssText = 'position:fixed;left:4px;bottom:2px;font:10px monospace;color:#888;z-index:9999;pointer-events:none'
        document.body.appendChild(el)
      }
      el.textContent = t
    }, stamp)
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const timed = async (cmd, args) => {
    const t0 = Date.now()
    try {
      return { r: await inv(cmd, args), ms: Date.now() - t0 }
    } catch (e) {
      return { err: String(e).slice(0, 200), ms: Date.now() - t0 }
    }
  }
  await main.keyboard.press('Escape')
  await main.evaluate(() => window.__avdp.getState().setModal(null))
  const origMonitor = await main.evaluate(() => window.__avdp.getState().settings.monitor)
  const marks = await saveMarks(main)
  if (origMonitor !== null) await main.evaluate(() => window.__avdp.getState().saveSettings({ monitor: null }))
  // música temporária (o banco do Isaac pode não ter músicas); apagada no fim
  const songId = await inv('song_save', {
    song: { id: 0, title: 'Hino de Teste', artist: 'Hinário', author: '', note: 'Repetir o refrão no fim', lyrics: 'Senhor, Tua palavra é luz\nque guia os passos meus\n\nRefrão\nSanto, santo é o Senhor\nDigno de louvor\n\nNa noite escura vens a mim\ne me dás Tua paz', paragraph_order: '', copyright: 'texto de teste', source: 'teste', theme_id: null, play_count: 0 },
  })

  try {
    // 1. operação ao vivo com música
    await main.click('.tabs button:nth-child(1)')
    await main.fill('.panel input.search', 'hino de teste')
    await main.waitForTimeout(400)
    await main.keyboard.press('Enter')
    await main.waitForTimeout(400)
    await main.click('.slide-card >> nth=1')
    await main.waitForTimeout(600)
    await setStamp()
    await shot('ours-principal')

    // 2. Bíblia com versículo ao vivo
    await main.click('.tabs button:nth-child(2)')
    await main.waitForTimeout(300)
    await main.fill('.bible-panel input.search', 'jo 3 16')
    await main.keyboard.press('Enter')
    await main.waitForFunction(() => document.querySelectorAll('.verse-row').length > 0, null, { timeout: 5000 }).catch(() => {})
    await main.waitForTimeout(400)
    await setStamp()
    await shot('ours-biblia')

    // 3. busca de mensagens + leitor
    await main.click('.tabs button:nth-child(3)')
    await main.waitForTimeout(300)
    await main.click('.subtabs.top button:has-text("Pesquisar")')
    await main.fill('.msg-panel input.search', '"sétimo selo"')
    await main.waitForTimeout(900)
    await main.click('.msg-results li:not(.direct) >> nth=0')
    await main.waitForTimeout(900)
    await setStamp()
    await shot('ours-mensagens')

    // ---------- casos de função: mensagens (modelo The Table) ----------
    const msg = (query, opts = {}, extra = {}) =>
      timed('msg_search', {
        q: { query, opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10, ...opts }, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 3, offset: 0, ...extra },
      })
    const msgCases = [
      ['todas as palavras', 'pilar de fogo', {}],
      ['frase exata', 'pilar de fogo', { mode: 'exact' }],
      ['frase exata pela sintaxe', '"pilar de fogo"', {}],
      ['proximidade (até 5)', 'anjo luz', { mode: 'near', near: 5 }],
      ['qualquer palavra', 'arrebatamento rapto', { mode: 'any' }],
      ['OU na sintaxe', 'Laodiceia OU Éfeso', {}],
      ['variações (radical)', 'profetizar', { variants: true }],
      ['aproximada (erro de digitação)', 'arebatamento', { fuzzy: true }],
      ['aproximada pela sintaxe', 'arebatamento~', {}],
      ['curinga no fim', 'serpent*', {}],
      ['curinga no meio', 'pro?eta', {}],
      ['excluir', 'semente serpente -Eva', {}],
      ['acentos ignorados', 'graca', {}],
      ['número por extenso', 'sete selos', {}],
      ['número em algarismo', '7 selos', {}],
      ['código de data', '65-1127B', {}],
      ['código de data longo', '1965-1127', {}],
      ['só títulos', 'titulo:selo', {}],
      ['XOR (The Table tem)', 'fé XOR obras', {}],
      ['proximidade na sintaxe', '"anjo luz"~5', {}],
      ['parênteses', '(arrebatamento OU rapto) noiva', {}],
      ['curinga com peso igual entre formas', 'pro?eta', {}],
      ['exclusão também nos títulos', 'graça -lei', {}],
      ['peso/boost (The Table tem)', 'graça^3 fé', {}],
      ['local (filtro)', 'fé', {}, { local: 'Jeffersonville' }],
      ['ordenar por título', 'pilar de fogo', { mode: 'exact' }, { sort: 'title' }],
      ['ordenar por local', 'pilar de fogo', { mode: 'exact' }, { sort: 'local' }],
      ['por mensagem + anos 1963–65 + data', 'pilar de fogo', { mode: 'exact' }, { by_message: true, sort: 'date', year_from: 1963, year_to: 1965 }],
    ]
    const msgOut = []
    for (const [name, query, opts, extra] of msgCases) {
      const { r, err, ms } = await msg(query, opts, extra)
      msgOut.push(
        err
          ? { caso: name, consulta: query, erro: err, ms }
          : {
              caso: name,
              consulta: query,
              total: r.total,
              ms,
              termos: r.terms.slice(0, 12),
              direto: r.direct.slice(0, 5).map((d) => `${d.code} ${d.title}`),
              primeiros: r.hits.slice(0, 3).map((h) => `${h.code} ${h.title}${extra?.by_message ? ` (${h.hits} parágrafos)` : ` §${h.num}`}${h.local ? ` · ${h.local}` : ''}: ${(h.marked ?? '').slice(0, 150)}`),
            },
      )
    }
    const stats = await inv('msg_stats')
    fs.writeFileSync(`${outDir}/ours-busca.json`, JSON.stringify({ stamp, banco: { datas: stats.groups, traducoes: stats.variants, com_texto: stats.with_text, paragrafos: stats.paragraphs }, cases: msgOut }, null, 2))

    // ---------- casos de função: Bíblia (modelo Holyrics) ----------
    const refs = ['jo 3 16', 'jo3:16', 'João 3.16', 'joao 3 16', '1co 13:4-7', '1 Co 13 4', 'i samuel 3', 'sl 23', 'Sl 119:105', 'gn 1', 'ap 22 21', 'jd 5', 'Jó 1:1', 'ct 2', 'mt 5:3-12', 'rm 8 28', 'apocalipse', 'xyz 9']
    const refOut = []
    for (const q of refs) {
      const { r, err } = await timed('bible_parse_ref', { input: q })
      refOut.push({ entrada: q, resultado: err ?? (r ? `${r.book}:${r.chapter}${r.verse ? ':' + r.verse : ''}${r.verse_end ? '-' + r.verse_end : ''}` : null) })
    }
    const bibles = await inv('bible_list')
    const books = await inv('bible_books')
    const versions = await main.evaluate(() => window.__avdp.getState().settings.bibleVersions)
    const coverage = {}
    for (const b of bibles) {
      const c = await inv('bible_chapter_counts', { bible: b.id })
      coverage[b.abbrev] = { versiculos: b.verses, livros_ausentes: books.filter((_, i) => !c[i]).map((x) => x.abbrev) }
    }
    // abre capítulos pela interface e anota o que aparece (inclui a versão de reserva quando falta o livro)
    const chapters = []
    for (const q of ['gn 1', 'jo 3', 'mc 1', 'sl 23', 'ap 22']) {
      await main.click('.tabs button:nth-child(2)')
      await main.fill('.bible-panel input.search', q)
      await main.keyboard.press('Enter')
      await main.waitForFunction(() => document.querySelectorAll('.verse-row').length > 0 || document.querySelector('.bible-center .center-empty'), null, { timeout: 4000 }).catch(() => {})
      await main.waitForTimeout(200)
      chapters.push(
        await main.evaluate((q) => ({
          entrada: q,
          titulo: document.querySelector('.bible-center h1')?.textContent,
          versoes: document.querySelector('.bible-center .center-title span')?.textContent,
          versiculos: document.querySelectorAll('.verse-row').length,
          aviso: document.querySelector('.banner.fallback')?.textContent ?? null,
        }), q),
      )
    }
    const bs = (query, opts = {}, scope = 'all', book = 43) =>
      timed('bible_search', { q: { query, opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10, ...opts }, bible: versions[0], scope, book, limit: 3, offset: 0 } })
    const bibleSearchCases = [
      ['todas', 'amor Deus', {}],
      ['frase exata', 'no princípio', { mode: 'exact' }],
      ['qualquer', 'graça misericórdia', { mode: 'any' }],
      ['próximas (até 3)', 'luz trevas', { mode: 'near', near: 3 }],
      ['palavra inteira desligada', 'amor', { whole_word: false }],
      ['variações', 'amar', { variants: true }],
      ['aproximada', 'misericodia', { fuzzy: true }],
      ['acentos ignorados', 'misericordia', {}],
      ['só AT', 'pastor', {}, 'ot'],
      ['só NT', 'pastor', {}, 'nt'],
      ['só no livro (Salmos)', 'pastor', {}, 'book', 19],
      ['referência digitada na pesquisa', 'jo 3 16', {}],
    ]
    const bsOut = []
    for (const [name, query, opts, scope, book] of bibleSearchCases) {
      const { r, err, ms } = await bs(query, opts, scope, book)
      bsOut.push(err ? { caso: name, consulta: query, erro: err } : { caso: name, consulta: query, total: r.total, ms, referencia: r.reference, primeiros: r.hits.slice(0, 3).map((h) => `${h.reference}: ${h.marked.slice(0, 110)}`) })
    }
    const hl = await timed('holyrics_versions', {})
    fs.writeFileSync(
      `${outDir}/ours-biblia.json`,
      JSON.stringify(
        {
          stamp,
          versoes_instaladas: bibles.map((b) => `${b.abbrev} (${b.language}) ${b.name} — ${b.verses} versículos`),
          versao_principal: versions,
          cobertura: coverage,
          referencias: refOut,
          capitulos_abertos: chapters,
          pesquisa: bsOut,
          holyrics_api_versoes: hl.err ? `erro: ${hl.err}` : hl.r,
        },
        null,
        2,
      ),
    )

    // ---------- casos de função: músicas ----------
    const ss = (query, opts = {}) => timed('songs_search', { query, opts: { mode: 'all', whole_word: false, variants: false, fuzzy: false, near: 10, ...opts }, sort: '' })
    const songOut = []
    for (const q of ['hino de teste', 'HINO', 'hyno', 'santo senhor', 'noite escura', 'xyzabc']) {
      const { r, err, ms } = await ss(q)
      songOut.push(err ? { consulta: q, erro: err } : { consulta: q, total: r.hits.length, aproximada: r.approximate, ms, primeiros: r.hits.slice(0, 2).map((h) => `${h.title}${h.marked ? ': ' + h.marked.slice(0, 80) : ''}`) })
    }
    fs.writeFileSync(`${outDir}/ours-musicas.json`, JSON.stringify({ stamp, musicas_no_banco: (await ss('')).r?.hits.length, cases: songOut }, null, 2))
    // sugestões ao digitar (mensagens)
    const sug = []
    for (const q of ['arreb', 'sete se', 'pilar de ', 'pilar de f', 'o sétimo se', '65-11']) {
      const { r, ms } = await timed('msg_suggest', { input: q })
      sug.push({ digitado: q, ms, pares: r?.pairs.map((p) => `${p.phrase} (≈${p.count})`), palavras: r?.terms.map((t) => `${t.word} (${t.count})`), titulos: r?.titles.map((g) => `${g.code} ${g.title}`) })
    }
    const busca = JSON.parse(fs.readFileSync(`${outDir}/ours-busca.json`, 'utf8'))
    fs.writeFileSync(`${outDir}/ours-busca.json`, JSON.stringify({ ...busca, sugestoes_ao_digitar: sug }, null, 2))
    console.log('casos gravados', stamp)
  } finally {
    await main.evaluate(async () => {
      window.__avdp.getState().endPresentation()
      await window.__TAURI_INTERNALS__.invoke('projection_close').catch(() => {})
      window.__avdp.getState().setProjectionOpen(false)
    })
    await inv('song_delete', { id: songId }).catch(() => {})
    await restoreMarks(main, marks)
    if (origMonitor !== null) await main.evaluate((m) => window.__avdp.getState().saveSettings({ monitor: m }), origMonitor)
  }
}
