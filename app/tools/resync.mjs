// Ressincroniza o Busca CBB (reagrupa com a regra nova) e mostra estatísticas.
export default async ({ main }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const t = Date.now()
  console.log('cbb:', await inv('msg_sync_cbb'), `${Date.now() - t} ms`)
  console.log('stats:', JSON.stringify(await inv('msg_stats')))
  const big = await inv('msg_list', { q: { filter: '', only_multi: true, sort: 'date', limit: 2000 } })
  const worst = big.rows.sort((a, b) => b.variant_count - a.variant_count).slice(0, 8)
  console.log('mais variantes:', worst.map((g) => `${g.code} ${g.title} (${g.variant_count})`).join(' | '))
  const r = await inv('msg_search', { q: { query: '65-1127B', opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10 }, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 3, offset: 0 } })
  console.log('65-1127B direto:', r.direct.map((g) => `${g.code} ${g.title}`).join(' | '))
  const t2 = await inv('msg_search', { q: { query: 'titulo:selo', opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10 }, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 3, offset: 0 } })
  console.log('titulo:selo:', t2.total, t2.direct.slice(0, 6).map((g) => `${g.code} ${g.title}`).join(' | '))
  const t3 = await inv('msg_search', { q: { query: 'semente serpente -Eva', opts: { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10 }, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 3, offset: 0 } })
  console.log('semente serpente -Eva direto:', t3.direct.map((g) => `${g.code} ${g.title}`).join(' | '), 'total', t3.total)
}
