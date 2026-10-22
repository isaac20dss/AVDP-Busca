// Exportar/importar fila entre computadores, pelos botões da lista (a janela de arquivo é
// respondida por código). Usa uma lista do Isaac só para LER; a lista importada é apagada no fim.
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async ({ main, shot }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const results = []
  const check = (name, ok, info = '') => {
    results.push(ok)
    console.log(`${ok ? 'OK ' : 'FALHOU'} ${name}${info ? ` — ${info}` : ''}`)
  }
  await main.waitForFunction(() => window.__avdp && document.querySelector('.playlist-head'), null, { timeout: 30000 })
  await main.evaluate(() => window.__avdp.getState().setModal(null))
  const file = join(tmpdir(), 'avdp-teste-fila.avdpfila')
  rmSync(file, { force: true })
  const before = await inv('get_settings')
  const lists0 = await inv('playlists_list')
  const source = lists0.find((l) => l.items >= 2 && (l.name.startsWith('QUI') || l.items >= 2))
  const keepId = await main.evaluate(() => window.__avdp.getState().playlistId)
  const created = []
  try {
    check('Botões Exportar/Importar fila na lista', (await main.locator('.playlist-head button[title^="Exportar esta fila"]').count()) === 1 && (await main.locator('.playlist-head button[title^="Importar fila"]').count()) === 1)
    // janela de arquivo: o modo de teste usa este caminho (o invoke do Tauri não pode ser trocado,
    // e a janela nativa abriria na tela do Isaac)
    await main.evaluate((p) => {
      window.__avdpFilaPath = p
    }, file)
    await main.selectOption('.playlist-head select', String(source.id))
    await sleep(800)
    await main.click('.playlist-head button[title^="Exportar esta fila"]')
    await sleep(1500)
    const f = JSON.parse(readFileSync(file, 'utf8'))
    const msg = f.items.find((i) => i.kind === 'message')?.message
    check('Arquivo .avdpfila gravado com a lista', f.kind === 'avdp-fila' && f.name === source.name && f.items.length === source.items, `${f.items.length} itens de "${f.name}"`)
    check('Mensagem vai pela fonte, com § e o texto', !!msg && !!msg.source && !!msg.source_id && msg.paragraphs.length > 10 && msg.num != null, msg && `${msg.code} ${msg.source}:${msg.source_id} §${msg.num} (${msg.paragraphs.length} §)`)
    check('Bíblia vai pela referência (livro/capítulo/versículo e versão)', f.items.filter((i) => i.kind === 'verse').every((i) => i.ref.book && i.ref.chapter))
    const sel = await main.evaluate(() => window.__avdp.getState().playlistId)

    // importar (como no outro PC; aqui o nome já existe, então vem com "(de …)")
    await main.click('.playlist-head button[title^="Importar fila"]')
    await sleep(2500)
    const toast1 = await main.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '))
    const imported = await main.evaluate(() => window.__avdp.getState().playlistId)
    created.push(imported)
    check('Importar cria a lista e abre', imported !== sel && /Fila importada/.test(toast1), toast1.slice(-160))
    const its = await inv('playlist_items', { id: imported })
    const orig = await inv('playlist_items', { id: source.id })
    check('Itens iguais aos da lista de origem', its.length === orig.length && its.every((x, k) => x.kind === orig[k].kind && x.label === orig[k].label))
    const mi = its.find((x) => x.kind === 'message')
    if (mi) {
      const r = JSON.parse(mi.ref)
      const g = await inv('msg_group', { id: r.groupId })
      check('Mensagem importada aponta para a mesma tradução e §', g.variants.some((v) => v.id === r.variantId && v.source === msg.source) && r.num === msg.num, `${g.code} variante ${r.variantId} §${r.num}`)
    }

    // importar de novo: atualiza a mesma lista
    await main.click('.playlist-head button[title^="Importar fila"]')
    await sleep(2500)
    const toast2 = await main.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '))
    const again = await main.evaluate(() => window.__avdp.getState().playlistId)
    const lists2 = await inv('playlists_list')
    check('Importar de novo atualiza a mesma lista (não duplica)', again === imported && lists2.length === lists0.length + 1 && /Fila atualizada/.test(toast2), `${lists0.length} → ${lists2.length}`)
    await shot('81-fila-importada')
  } finally {
    await main.evaluate(() => {
      delete window.__avdpFilaPath
    })
    for (const id of created) await inv('playlist_delete', { id })
    await inv('set_setting', { key: 'fila_imports', value: before.fila_imports ?? '{}' })
    await inv('set_setting', { key: 'fila_dir', value: before.fila_dir ?? '' })
    const ls = await inv('playlists_list')
    const back = ls.some((l) => l.id === keepId) ? keepId : ls[0]?.id
    if (back) await main.evaluate(async (id) => window.__avdp.getState().setPlaylist(id, await window.__TAURI_INTERNALS__.invoke('playlist_items', { id })), back)
    rmSync(file, { force: true })
    check('Limpeza: listas como antes', ls.length === lists0.length, `${ls.length} listas`)
  }
  console.log(`\n${results.filter(Boolean).length} de ${results.length} verificações`)
}
