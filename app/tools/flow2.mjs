// Testa: Bíblia PT, digitar para localizar, atalhos do Holyrics, aba Mensagens (lista primeiro),
// procurar dentro da mensagem, lista com parágrafo, configurações de atalhos, biblioteca de mídia.
// Não projeta na TV (usa "Em janela" e devolve o monitor original no fim) e não deixa dado de teste na lista.
import { restoreMarks, saveMarks } from './marks.mjs'

export default async ({ main, shot, projection }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const state = () => main.evaluate(() => {
    const s = window.__avdp?.getState?.()
    return s ? { live: s.live?.title ?? null, idx: s.liveIndex, blank: s.blank, tab: s.tab, playlist: s.playlist.map((p) => p.label) } : null
  })
  await main.keyboard.press('Escape')
  const origMonitor = await main.evaluate(() => window.__avdp.getState().settings.monitor)
  let tempMedia = false
  const marks = await saveMarks(main)
  if (origMonitor !== null) await main.evaluate(() => window.__avdp.getState().saveSettings({ monitor: null }))
  try {

  // Bíblia em português
  const bibles = await inv('bible_list')
  console.log('bíblias:', bibles.map((b) => `${b.abbrev}:${b.verses}`).join(' '), '| principal:', JSON.stringify(await main.evaluate(() => window.__avdp.getState().settings.bibleVersions)))
  await main.click('.tabs button:nth-child(2)')
  await main.waitForTimeout(500)
  // digitar com o foco fora da caixa: vai para a referência
  await main.click('.center-head h1')
  await main.keyboard.type('sl 23 1')
  await main.keyboard.press('Enter')
  await main.waitForTimeout(900)
  await shot('60-biblia-pt-digitar')
  console.log('estado após sl 23 1:', JSON.stringify(await state()))

  // atalhos do Holyrics
  await main.click('.center-head h1')
  await main.keyboard.press('ArrowRight')
  await main.keyboard.press('F10')
  await main.waitForTimeout(200)
  console.log('após → e F10:', JSON.stringify(await state()))
  await main.keyboard.press('F10')
  await main.keyboard.press('F8')
  await main.waitForTimeout(200)
  console.log('após F8:', JSON.stringify(await state()))
  await main.keyboard.press('F9')
  await main.waitForTimeout(200)
  console.log('após F9:', JSON.stringify(await state()))
  await main.keyboard.press('Escape')
  await main.waitForTimeout(200)
  console.log('após Esc:', JSON.stringify(await state()))
  // letra solta não faz nada fora da Bíblia
  await main.click('.tabs button:nth-child(1)')
  await main.click('.center-empty, .slides-view')
  await main.keyboard.press('b')
  console.log('após b solto em Letras:', JSON.stringify(await state()))

  // Mensagens: lista primeiro
  await main.click('.tabs button:nth-child(3)')
  await main.waitForTimeout(800)
  await shot('61-mensagens-lista-primeiro')
  await main.fill('.msg-panel input.search', 'sexto selo')
  await main.waitForTimeout(700)
  await main.click('.result-list li >> nth=0')
  await main.waitForTimeout(900)
  await main.keyboard.press('Control+Shift+F')
  await main.keyboard.type('lua sangue')
  await main.waitForTimeout(400)
  await main.keyboard.press('Enter')
  await main.waitForTimeout(400)
  await shot('62-procurar-na-mensagem')
  await main.keyboard.press('Escape')
  await main.click('.reader-body .para.focus')
  await main.keyboard.press('Control+Shift+L')
  await main.waitForTimeout(500)
  await shot('63-lista-com-paragrafo')
  console.log('lista:', JSON.stringify((await state())?.playlist))
  // tira o item de teste (desfazer grava a lista anterior)
  await main.evaluate(() => window.__avdp.getState().undoPlaylist())
  console.log('lista depois de desfazer:', JSON.stringify((await state())?.playlist))

  // Configurações → Atalhos
  await main.click('.live-controls .icon-btn:last-child')
  await main.waitForTimeout(400)
  await main.click('.settings-nav button:has-text("Atalhos")')
  await main.waitForTimeout(400)
  await shot('64-config-atalhos')
  await main.keyboard.press('Escape')
  await main.waitForTimeout(300)

  // Mídia (usa o que já está na biblioteca; se estiver vazia, adiciona só durante o teste e tira no fim)
  tempMedia = !(await inv('media_list', { kind: '', query: '' })).length
  if (tempMedia)
    await inv('media_add', { paths: ['C:\\Holyrics\\Holyrics\\data\\theme\\img', 'C:\\Holyrics\\Holyrics\\files\\videos\\VIDEO02.mp4'] })
  await main.click('.tabs button:nth-child(5)')
  await main.waitForTimeout(800)
  await main.dblclick('.media-list li >> nth=0')
  await main.waitForTimeout(1200)
  await shot('65-midia-imagem')
  await main.dblclick('.media-list li:has-text("VIDEO02")')
  await main.waitForTimeout(2500)
  await shot('66-midia-video')
  const p = projection()
  if (p) await shot('67-projecao-video', p)
  } finally {
    await main.evaluate(async () => {
      window.__avdp.getState().endPresentation()
      await window.__TAURI_INTERNALS__.invoke('projection_close').catch(() => {})
      window.__avdp.getState().setProjectionOpen(false)
    })
    if (origMonitor !== null) await main.evaluate((m) => window.__avdp.getState().saveSettings({ monitor: m }), origMonitor)
    await restoreMarks(main, marks)
    if (tempMedia) {
      for (const m of await inv('media_list', { kind: '', query: '' })) await inv('media_remove', { id: m.id })
      console.log('mídia de teste retirada da biblioteca')
    }
  }
}
