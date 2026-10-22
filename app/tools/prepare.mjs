// Prepara dados de teste pelos comandos do app: mensagens locais, Busca CBB e Bíblias do EasySlides.
export default async ({ main, shot }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const path = await inv('msg_default_local_path')
  console.log('banco local:', path)
  let t = Date.now()
  console.log('local:', JSON.stringify(await inv('msg_import_local', { path })), `${Date.now() - t} ms`)
  t = Date.now()
  console.log('cbb:', await inv('msg_sync_cbb'), `${Date.now() - t} ms`)
  for (const f of await inv('bible_scan_easyslides')) {
    if (!/public domain/i.test(f.license)) continue
    const lang = /english/i.test(f.language) ? 'en' : /chinese/i.test(f.language) ? 'zh' : 'pt'
    if (lang !== 'en') continue
    const n = await inv('bible_import_mybible', { path: f.path, meta: { id: f.abbrev.toLowerCase(), name: f.name, abbrev: f.abbrev, license: f.license, language: lang, source: 'EasySlides' } })
    console.log('bíblia', f.abbrev, n)
  }
  console.log('stats:', JSON.stringify(await inv('msg_stats')))
  await inv('set_setting', { key: 'welcome_done', value: '1' })
  await main.reload()
  await main.waitForTimeout(1500)
  await shot('10-preparado')
}
