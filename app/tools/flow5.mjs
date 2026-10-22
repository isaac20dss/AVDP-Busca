// 6ª leva: fonte Tabernáculo da Fé (busca.tabernaculodafe.org.br). Só lê e abre mensagens; não projeta.
// Rodar depois de sincronizar (Configurações → Mensagens → Tabernáculo da Fé → Sincronizar agora).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async ({ main, shot }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const results = []
  const check = (name, ok, info = '') => {
    results.push(ok)
    console.log(`${ok ? 'OK ' : 'FALHOU'} ${name}${info ? ` — ${info}` : ''}`)
  }
  const ms = (query, extra = {}) =>
    inv('msg_search', { q: { query, opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10 }, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 200, offset: 0, ...extra } })
  await main.waitForFunction(() => window.__avdp && document.querySelector('.tabs'), null, { timeout: 30000 })
  await main.evaluate(() => window.__avdp.getState().setModal(null))

  const st = await inv('msg_stats')
  const bySource = Object.fromEntries(st.by_source)
  check('Fonte tdf com texto', (bySource.tdf ?? 0) >= 400, JSON.stringify(st.by_source))
  check('Cópias antigas escondidas contadas', st.superseded > 0, `${st.superseded}`)
  const settings = await inv('get_settings')
  check('Data da sincronização guardada', !!settings.tdf_synced_at && !!settings.tdf_versions, settings.tdf_synced_at)

  // pesquisa: nenhuma cópia escondida aparece sem filtro de fonte
  const r = await ms('arrebatamento')
  const groups = [...new Set(r.hits.map((h) => h.group_id))].slice(0, 40)
  const hidden = new Set()
  for (const g of groups) for (const v of (await inv('msg_group', { id: g })).variants) if (v.superseded_by) hidden.add(v.id)
  const leaked = r.hits.filter((h) => groups.includes(h.group_id) && hidden.has(h.variant_id))
  check('Pesquisa sem cópias escondidas', hidden.size > 0 && leaked.length === 0, `${hidden.size} escondidas nesses grupos, ${leaked.length} na lista`)
  const dupKey = new Map()
  for (const h of r.hits.filter((h) => ['GO', 'GVD'].includes(h.translation))) {
    const k = `${h.group_id}|${h.translation}|${h.num}`
    dupKey.set(k, (dupKey.get(k) ?? 0) + 1)
  }
  const dups = [...dupKey.values()].filter((n) => n > 1).length
  check('Mesmo § da mesma tradução (GO/GVD) só uma vez', dups === 0, `${dups} repetidos`)
  const rl = await ms('arrebatamento', { sources: ['local'] })
  check('Filtrando pela fonte "Banco local", as cópias aparecem', rl.total > 0, `${rl.total} parágrafos`)

  // mensagem que só o site tinha nesta tradução e data com dia 00
  const raw = await ms('65-1204')
  const g1204 = raw.direct[0] && (await inv('msg_group', { id: raw.direct[0].id }))
  const t1204 = g1204?.variants.find((v) => v.source === 'tdf')
  check('65-1204 tem a tradução do site (GVD) com texto', !!t1204 && t1204.translation === 'GVD' && t1204.para_count > 100, t1204 && `${t1204.title} ${t1204.para_count}§`)
  const r0100 = await ms('50-0100')
  const g0100 = r0100.direct[0] && (await inv('msg_group', { id: r0100.direct[0].id }))
  check('Data só com o mês (19500100) vira 50-0100', !!g0100?.variants.some((v) => v.source === 'tdf'), g0100 && `${g0100.code} ${g0100.title}`)

  // leitor: 48-0304 tem GO local (cópia antiga) + GO do site → só uma aba GO
  await main.click('.tabs button:nth-child(3)')
  await sleep(800)
  await main.click('.subtabs.top button:has-text("Pesquisar")')
  await sleep(500)
  await main.fill('.msg-panel input.search', '48-0304')
  await sleep(1200)
  await main.click('.msg-results li.direct >> nth=0')
  await sleep(1500)
  const tabs = await main.evaluate(() => [...document.querySelectorAll('.translations .tr-tab')].map((b) => `${b.querySelector('b')?.textContent}|${b.querySelector('small')?.textContent}`))
  const go = tabs.filter((t) => t.startsWith('GO|'))
  check('Leitor: uma aba GO só (a do site)', go.length === 1 && /Tabernáculo da Fé/.test(go[0]), tabs.join(' ; '))
  const head = await main.evaluate(() => document.querySelector('.center-title h1')?.textContent ?? '')
  check('Título do site em caixa normal', /O Anjo de Deus/.test(head), head)
  await shot('71-leitor-tdf')
  await main.fill('.msg-panel input.search', '')

  const ok = results.filter(Boolean).length
  console.log(`\n${ok} de ${results.length} verificações`)
}
