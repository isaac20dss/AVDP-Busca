// Mostra o estado do banco (mensagens, Bíblias, músicas, mídia).
export default async ({ main }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const s = await inv('msg_stats')
  console.log('mensagens:', JSON.stringify({ grupos: s.groups, variantes: s.variants, com_texto: s.with_text, varias: s.multi, paragrafos: s.paragraphs, fontes: s.by_source }))
  const g = await inv('msg_list', { q: { filter: '', sort: 'date', limit: 5000 } })
  const placeholders = g.rows.filter((r) => r.code.endsWith('????')).length
  const big = g.rows.filter((r) => r.variant_count > 4).map((r) => `${r.code}(${r.variant_count})`)
  console.log('grupos só-ano:', placeholders, '| grupos com >4 variantes:', big.join(' ') || 'nenhum')
  console.log('bíblias:', (await inv('bible_list')).map((b) => `${b.abbrev}:${b.verses}`).join(' '))
  const songs = await inv('songs_search', { query: '', opts: { mode: 'all', whole_word: false, variants: false, fuzzy: false, near: 10 }, sort: '' })
  console.log('músicas:', songs.hits.map((h) => h.title).join(' | '))
  console.log('mídia:', (await inv('media_list', { kind: '', query: '' })).length)
  const set = await inv('get_settings')
  console.log('cbb_synced_at:', set.cbb_synced_at, '| holyrics cfg:', set.holyrics ? 'sim' : 'não')
  const ui = set.ui ? JSON.parse(set.ui) : {}
  console.log('monitor:', ui.monitor, 'bibleViaHolyrics:', ui.bibleViaHolyrics, 'versões:', ui.bibleVersions)
}
