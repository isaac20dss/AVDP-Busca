// Guarda e devolve os favoritos/histórico da Bíblia do Isaac em volta de um teste
// (o teste projeta versículos e eles entram no histórico).
export async function saveMarks(main) {
  return main.evaluate(async () => {
    const m = await window.__TAURI_INTERNALS__.invoke('get_settings')
    return { favs: m.bible_favs ?? '[]', hist: m.bible_hist ?? '[]' }
  })
}

export async function restoreMarks(main, saved) {
  await main.evaluate(async (s) => {
    await window.__TAURI_INTERNALS__.invoke('set_setting', { key: 'bible_favs', value: s.favs })
    await window.__TAURI_INTERNALS__.invoke('set_setting', { key: 'bible_hist', value: s.hist })
    await window.__avdpBible?.getState().loadMarks()
  }, saved)
}
