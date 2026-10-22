// Ponta a ponta da 5ª leva: R7 (pares de palavras), R8 (peso igual entre formas), R9 (títulos diretos seguem a
// consulta), R10 ("a b"~N e parênteses), botão de papel de parede fora da Mídia, e exportação para o Holyrics
// contra um Holyrics SIMULADO (servidor local que só registra; o Holyrics de verdade não é tocado).
// Seguro: devolve a configuração do Holyrics, apaga músicas/texto/lista temporários e não projeta nada.
// Uso: node tools/cdp.mjs tools/flow4.mjs <pasta-de-prints>
import http from 'node:http'
import { restoreMarks, saveMarks } from './marks.mjs'

export default async ({ main, shot }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const ok = []
  const bad = []
  const check = (name, cond, info = '') => {
    ;(cond ? ok : bad).push(`${name}${info ? ` — ${info}` : ''}`)
    console.log(cond ? 'OK  ' : 'FALHA', name, info)
  }
  const sleep = (ms) => main.waitForTimeout(ms)
  await main.reload()
  await main.waitForFunction(() => window.__avdp && document.querySelector('.tabs'), null, { timeout: 20000 })
  await sleep(1200)
  const marks = await saveMarks(main)
  const ms = (query, opts = {}, extra = {}) =>
    inv('msg_search', { q: { query, opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10, ...opts }, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 10, offset: 0, ...extra } })
  const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  // ---------- R10: proximidade na sintaxe e parênteses ----------
  const near = await ms('"anjo luz"~5')
  const near0 = await ms('anjo luz', { mode: 'near', near: 5 })
  check('R10 "anjo luz"~5 = modo Próximas até 5', near.total > 0 && near.total === near0.total, `${near.total} = ${near0.total}`)
  const par = await ms('(arrebatamento OU rapto) noiva')
  const parA = await ms('arrebatamento noiva')
  const parB = await ms('rapto noiva')
  check('R10 parênteses: (arrebatamento OU rapto) noiva', par.total > 0 && par.total >= Math.max(parA.total, parB.total) && par.total <= parA.total + parB.total, `${par.total} entre ${Math.max(parA.total, parB.total)} e ${parA.total + parB.total}`)

  // ---------- R8: formas expandidas com peso parecido ----------
  const w = await ms('pro?eta')
  check('R8 curinga: a forma comum (profeta) vem primeiro', /⟦profeta/i.test(w.hits[0]?.marked ?? ''), (w.hits[0]?.marked ?? '').match(/⟦[^⟧]+⟧/)?.[0])

  const fz = await ms('arebatamento', { fuzzy: true })
  check('R8 aproximada: a forma comum (arrebatamento) vem primeiro', /⟦arrebatamento⟧/i.test(fz.hits[0]?.marked ?? ''), (fz.hits[0]?.marked ?? '').match(/⟦[^⟧]+⟧/)?.[0])

  // ---------- R9: títulos diretos seguem a consulta ----------
  const x = await ms('fé XOR obras')
  check('R9 XOR não traz título com as duas palavras', x.direct.every((g) => !(fold(g.title).includes('fe ') && fold(g.title).includes('obras'))), x.direct.map((g) => g.title).join(' | '))
  const ex = await ms('graça -lei')
  check('R9 exclusão vale nos títulos', ex.direct.length > 0 && ex.direct.every((g) => !/\blei\b/i.test(fold(g.title))), ex.direct.map((g) => g.title).slice(0, 3).join(' | '))
  const fe = await ms('fé')
  check('R9 palavra curta ("fé") também puxa título', fe.direct.length > 0, fe.direct.map((g) => g.title).slice(0, 2).join(' | '))
  const fe60 = await ms('fé', {}, { year_from: 1964, year_to: 1965 })
  check('R9 títulos diretos obedecem ao filtro de anos', fe60.direct.every((g) => /^6[45]-/.test(g.code)) && fe60.direct.length < fe.direct.length + 99, fe60.direct.map((g) => g.code).join(', '))
  const de = await ms('de')
  check('R9 palavra vazia ("de") não puxa título', de.direct.length === 0)

  // ---------- R7: pares de palavras ----------
  const s1 = await inv('msg_suggest', { input: 'sete se' })
  check('R7 "sete se" sugere "sete selos"', s1.pairs[0]?.phrase === 'sete selos', s1.pairs.slice(0, 3).map((p) => `${p.phrase} (${p.count})`).join(', '))
  const s3 = await inv('msg_suggest', { input: 'o sétimo se' })
  check('R7 o par mostra o que foi digitado (com acento)', s3.pairs[0]?.phrase.startsWith('o sétimo se'), s3.pairs[0]?.phrase)
  const s2 = await inv('msg_suggest', { input: 'pilar de ' })
  check('R7 "pilar de " sugere a palavra seguinte (fogo)', s2.pairs[0]?.word === 'fogo', s2.pairs.slice(0, 3).map((p) => p.phrase).join(', '))
  await main.click('.tabs button:nth-child(3)')
  await sleep(300)
  await main.click('.subtabs.top button:has-text("Pesquisar")')
  await main.click('.msg-panel input.search')
  await main.fill('.msg-panel input.search', 'sete se')
  // o build de teste (sem otimização) responde em ~0,3–1 s; o instalado, em dezenas de ms
  await main.waitForSelector('.typeahead li.pair', { timeout: 5000 }).catch(() => {})
  const firstLi = await main.evaluate(() => document.querySelector('.typeahead li')?.className + ' | ' + document.querySelector('.typeahead li')?.textContent)
  check('R7 lista de sugestões mostra o par primeiro', firstLi.startsWith('pair') && firstLi.includes('sete selos'), firstLi)
  await shot('80-pares')
  await main.keyboard.press('ArrowDown')
  await main.keyboard.press('Enter')
  await sleep(200)
  check('R7 Enter completa com o par', (await main.inputValue('.msg-panel input.search')) === 'sete selos ')
  await main.keyboard.press('Escape')

  // ---------- Mídia sem o botão de papel de parede ----------
  const tempMedia = !(await inv('media_list', { kind: '', query: '' })).length
  if (tempMedia) await inv('media_add', { paths: ['C:\\Holyrics\\Holyrics\\data\\theme\\img\\IMAGE04.jpg'] })
  await main.click('.tabs button:nth-child(5)')
  await sleep(600)
  await main.click('.media-list li >> nth=0')
  await sleep(400)
  const mediaButtons = await main.evaluate(() => [...document.querySelectorAll('.media-center .toolbar button')].map((b) => b.textContent.trim()))
  check('Mídia sem o botão "Papel de parede"', mediaButtons.length > 0 && !mediaButtons.some((t) => t.includes('Papel de parede')), mediaButtons.join(' | '))
  if (tempMedia) for (const m of await inv('media_list', { kind: '', query: '' })) await inv('media_remove', { id: m.id })

  // ---------- exportação para o Holyrics (simulado) ----------
  const got = []
  let denyPermissions = false
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const u = new URL(req.url, 'http://x')
      const action = u.pathname.replace('/api/', '')
      const data = body ? JSON.parse(body) : {}
      got.push({ action, token: u.searchParams.get('token'), data })
      const reply =
        action === 'CheckPermissions' && denyPermissions
          ? { status: 'error', error: { unauthorized_actions: 'AddToPlaylist', request_status: 'pending' } }
          : action === 'SearchLyrics'
            ? { status: 'ok', data: /hino de teste/i.test(data.text) ? [{ id: 777, title: 'Hino de Teste', artist: '', archived: false }, { id: 778, title: 'Hino de Teste', artist: '', archived: true }] : [] }
            : action === 'GetCurrentSchedule'
              ? { status: 'ok', data: { type: 'event', name: 'Culto de domingo', datetime: '2026-10-18 19:00' } }
              : action === 'GetBibleVersionsV2'
                ? { status: 'ok', data: [{ key: 'pt_acf', version: 'pt_acf', title: 'Almeida Corrigida Fiel' }, { key: 'pt_nvi', version: 'pt_nvi', title: 'Nova Versão Internacional' }] }
                : { status: 'ok', data: null }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(reply))
    })
  })
  await new Promise((r) => server.listen(18091, '127.0.0.1', r))
  const origHolyrics = (await inv('get_settings')).holyrics ?? ''
  const created = { songs: [], text: 0, playlist: 0 }
  const before = await main.evaluate(() => ({ id: window.__avdp.getState().playlistId, items: window.__avdp.getState().playlist }))
  try {
    await inv('set_setting', { key: 'holyrics', value: JSON.stringify({ host: '127.0.0.1', port: 18091, token: 'teste-simulado' }) })
    const mk = (title) => ({ id: 0, title, artist: '', author: '', note: '', lyrics: 'Primeira linha\nsegunda\n\nRefrão\nCoro', paragraph_order: '', copyright: '', source: 'teste', theme_id: null, play_count: 0 })
    created.songs.push(await inv('song_save', { song: mk('Hino de Teste') }))
    created.songs.push(await inv('song_save', { song: mk('Outra Música de Teste') }))
    created.text = await inv('text_save', { doc: { id: 0, title: 'Aviso de teste', body: 'Linha um do aviso.\n\nLinha dois.', source: 'teste' } })
    const grp = (await inv('msg_list', { q: { filter: '63-0318', limit: 1, only_with_text: true } })).rows[0]
    const ginfo = await inv('msg_group', { id: grp.id })
    const vid = ginfo.preferred_variant ?? ginfo.variants.find((v) => v.para_count > 0).id
    const paras = await inv('msg_paragraphs', { variantId: vid })
    const p5 = paras.find((p) => p.num === 5) ?? paras[0]
    created.playlist = await inv('playlist_create', { name: 'Teste exportação' })
    const items = [
      { kind: 'song', ref: JSON.stringify({ id: created.songs[0] }), label: 'Hino de Teste' },
      { kind: 'song', ref: JSON.stringify({ id: created.songs[1] }), label: 'Outra Música de Teste' },
      { kind: 'verse', ref: JSON.stringify({ book: 43, chapter: 3, verse: 16, verses: [16, 17], bible: 'acf' }), label: 'João 3:16-17 — ACF' },
      { kind: 'message', ref: JSON.stringify({ groupId: grp.id, variantId: vid, seq: p5.seq, num: p5.num }), label: `${grp.code} ${grp.title} — §${p5.num}` },
      { kind: 'text', ref: JSON.stringify({ id: created.text }), label: 'Aviso de teste' },
      { kind: 'media', ref: JSON.stringify({ type: 'image', path: 'C:\\x.jpg', name: 'x' }), label: 'Imagem de teste' },
    ]
    await main.evaluate(([id, its]) => window.__avdp.getState().setPlaylist(id, its), [created.playlist, items])
    await sleep(300)
    // o confirm do app é o do Tauri (assíncrono, janela nativa): no teste, responde por código, sem janela na tela
    const answer = (yes) =>
      main.evaluate((y) => {
        window.__confirmOrig ??= window.confirm
        window.__confirmMsg = ''
        window.confirm = async (m) => {
          window.__confirmMsg = String(m)
          return y
        }
      }, yes)
    // "Cancelar" segura a exportação
    await answer(false)
    await main.click('.playlist-head button[title^="Enviar esta lista ao Holyrics"]')
    await sleep(1500)
    check('Exportar: "Cancelar" não envia nada', !got.some((g) => g.action === 'AddToPlaylist'), got.map((g) => g.action).join(', '))
    got.length = 0
    await answer(true)
    await main.click('.playlist-head button[title^="Enviar esta lista ao Holyrics"]')
    await sleep(2500)
    const dialogText = await main.evaluate(() => window.__confirmMsg)
    check('Exportar: confirmação diz para qual programação do Holyrics vai', dialogText.includes('Culto de domingo · 2026-10-18 19:00'), dialogText.replace(/\n+/g, ' / '))
    const toastText = await main.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '))
    const add = got.find((g) => g.action === 'AddToPlaylist')
    const its = add?.data.items ?? []
    check('Exportar: confere permissões antes e usa o token', got[0]?.action === 'CheckPermissions' && got[0]?.data.actions === 'SearchLyrics,AddToPlaylist' && got.every((g) => g.token === 'teste-simulado'), got.map((g) => g.action).join(', '))
    check('Exportar: 1º item é o título com o nome da lista', its[0]?.type === 'title' && its[0]?.name === 'AVDP — Lista', JSON.stringify(its[0]))
    check('Exportar: música achada no Holyrics entra como a música dele (ignora a arquivada)', its[1]?.type === 'song' && its[1]?.id === '777', JSON.stringify(its[1]))
    check('Exportar: música não achada vai como texto', its[2]?.type === 'plain_text' && its[2]?.name === 'Outra Música de Teste' && its[2]?.text.includes('\n\n'), JSON.stringify(its[2]).slice(0, 120))
    check('Exportar: trecho da Bíblia vai com os ids e a versão do Holyrics (ACF → pt_acf)', its[3]?.type === 'verse' && JSON.stringify(its[3]?.ids) === '["43003016","43003017"]' && its[3]?.version === 'pt_acf', JSON.stringify(its[3]))
    check('Exportar: mensagem vai como texto a partir do §', its[4]?.type === 'plain_text' && its[4]?.name.includes(`§${p5.num}`) && its[4]?.text.startsWith(p5.text.slice(0, 30)), `${its[4]?.name} | ${(its[4]?.text ?? '').slice(0, 60)}`)
    check('Exportar: texto vai como texto', its[5]?.type === 'plain_text' && its[5]?.name === 'Aviso de teste')
    check('Exportar: mídia fica de fora e o resumo avisa', its.length === 6 && /5 itens enviados para "Culto de domingo/.test(toastText) && /1 música/.test(toastText) && /1 ficaram de fora/.test(toastText), toastText)
    // token sem permissão: mensagem clara e nada enviado
    denyPermissions = true
    got.length = 0
    await main.click('.playlist-head button[title^="Enviar esta lista ao Holyrics"]')
    await sleep(1500)
    const errToast = await main.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '))
    check('Exportar: token sem permissão dá mensagem clara e não envia', /não tem permissão para AddToPlaylist/.test(errToast) && !got.some((g) => g.action === 'AddToPlaylist'), errToast.slice(-160))
    // bug do confirm (excluir lista): "Cancelar" tem de segurar a exclusão
    await answer(false)
    await main.click('.playlist-head button[title="Excluir lista"]')
    await sleep(800)
    const still = (await inv('playlists_list')).some((l) => l.id === created.playlist)
    check('Excluir lista: "Cancelar" não apaga (confirm assíncrono do Tauri esperado)', still)
    check('Exportar: não usa event_id (pago)', !JSON.stringify(add?.data ?? {}).includes('event_id'))
  } finally {
    await main.evaluate(() => {
      if (window.__confirmOrig) window.confirm = window.__confirmOrig
    })
    server.close()
    await inv('set_setting', { key: 'holyrics', value: origHolyrics })
    for (const id of created.songs) await inv('song_delete', { id }).catch(() => {})
    if (created.text) await inv('text_delete', { id: created.text }).catch(() => {})
    await main.evaluate(([id, its]) => window.__avdp.getState().setPlaylist(id, its), [before.id, before.items])
    if (created.playlist) await inv('playlist_delete', { id: created.playlist }).catch(() => {})
    await restoreMarks(main, marks)
    const h = (await inv('get_settings')).holyrics ?? ''
    check('Configuração do Holyrics devolvida', h === origHolyrics)
    console.log(`\n${ok.length} ok, ${bad.length} falhas`)
    if (bad.length) console.log('FALHAS:\n' + bad.join('\n'))
  }
}
