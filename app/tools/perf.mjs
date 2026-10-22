// Medição de desempenho (antes/depois de cada otimização). SÓ com AVDP_DATA_DIR numa cópia do banco.
// Uso: node tools/cdp.mjs tools/perf.mjs <pasta>   → imprime uma tabela e grava <pasta>/perf.json
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async ({ main }) => {
  const outDir = process.argv[3] ?? '.'
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
  const r = {}

  // partida: recarrega e mede até a tela pronta
  const t0 = Date.now()
  await main.reload()
  await main.waitForFunction(() => window.__avdp && window.__avdpMsg && document.querySelector('.tabs') && !document.querySelector('.loading'), null, { timeout: 60000 })
  r.startup_ms = Date.now() - t0
  await main.evaluate(() => {
    const s = window.__avdp.getState()
    s.setModal(null)
    s.saveSettings({ monitor: null, msgView: 'paragrafos' })
  })
  await sleep(800)

  // tempo até o próximo quadro pintado depois de uma ação na página
  const frame = (fnSrc, arg) =>
    main.evaluate(
      async ([src, a]) => {
        const fn = new Function('a', src)
        const t = performance.now()
        await fn(a)
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
        return performance.now() - t
      },
      [fnSrc, arg],
    )

  // conta as chamadas ao Rust durante uma ação (o IPC do Tauri passa por http://ipc.localhost/<comando>)
  await main.evaluate(() => performance.setResourceTimingBufferSize(5000))
  const resetCount = () => main.evaluate(() => performance.clearResourceTimings())
  const counts = () =>
    main.evaluate(() => {
      const out = {}
      for (const e of performance.getEntriesByType('resource')) {
        const m = e.name.match(/ipc\.localhost\/([^?]+)/)
        if (m) out[m[1]] = (out[m[1]] ?? 0) + 1
      }
      return out
    })

  // ---------- mensagem grande ----------
  await main.click('.tabs button:nth-child(3)')
  const big = (await inv('msg_list', { q: { filter: '63-0324N', limit: 5, offset: 0 } })).rows[0]
  await resetCount()
  r.open_big_ms = await frame('return window.__avdpMsg.getState().open(a)', big.id)
  await sleep(1500)
  r.open_big_invokes = await counts()
  r.big_slides = await main.evaluate(() => window.__avdp.getState().item?.slides.length)
  r.big_paras = await main.evaluate(() => document.querySelectorAll('.reader-body .para').length)

  // mover a prévia (cursor) 20 vezes
  const cur = []
  for (let i = 1; i <= 20; i++) cur.push(await frame('window.__avdp.getState().setCursor(a)', i * 3))
  r.cursor_move_ms = med(cur)

  // mudança que não tem nada a ver com o leitor (um aviso)
  const toast = []
  for (let i = 0; i < 10; i++) toast.push(await frame("window.__avdp.getState().toast('teste de desempenho ' + a)", i))
  r.unrelated_change_ms = med(toast)

  // projetar e avançar
  const step = []
  await frame('window.__avdp.getState().project(window.__avdp.getState().item, 0)')
  for (let i = 0; i < 10; i++) step.push(await frame('window.__avdp.getState().step(1)'))
  r.step_live_ms = med(step)
  await frame('window.__avdp.getState().endPresentation()')

  // modo Slides
  r.slides_view_ms = await frame("window.__avdp.getState().saveSettings({ msgView: 'slides' })")
  const curS = []
  for (let i = 1; i <= 10; i++) curS.push(await frame('window.__avdp.getState().setCursor(a)', i * 2))
  r.cursor_move_slides_ms = med(curS)
  r.paragraphs_view_ms = await frame("window.__avdp.getState().saveSettings({ msgView: 'paragrafos' })")

  // ---------- Rust: consultas ----------
  const timeInv = async (cmd, args, n = 5) => {
    const ts = []
    for (let i = 0; i < n; i++) ts.push(await main.evaluate(async ([c, a]) => { const t = performance.now(); await window.__TAURI_INTERNALS__.invoke(c, a); return performance.now() - t }, [cmd, args]))
    return Math.round(med(ts))
  }
  const opts = { mode: 'all', whole_word: true, variants: false, fuzzy: false, near: 10 }
  const q = (query) => ({ q: { query, opts, year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: false, sort: 'relevance', by_message: false, limit: 200, offset: 0 } })
  r.search_ms = await timeInv('msg_search', q('sétimo selo'))
  r.search_common_ms = await timeInv('msg_search', q('deus'))
  r.list_ms = await timeInv('msg_list', { q: { filter: '', only_with_text: true, only_multi: false, sort: 'date', limit: 300, offset: 0 } })
  r.group_ms = await timeInv('msg_group', { id: big.id })
  r.paragraphs_ms = await timeInv('msg_paragraphs', { variantId: (await inv('msg_group', { id: big.id })).preferred_variant })
  r.stats_ms = await timeInv('msg_stats', {}, 3)

  // ---------- pesquisa na tela ----------
  await main.click('.subtabs.top button:has-text("Pesquisar")')
  const ts = await main.evaluate(async () => {
    const inp = document.querySelector('.msg-panel input.search')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(inp, '')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((res) => setTimeout(res, 300))
    const t = performance.now()
    set.call(inp, 'cordeiro')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    while (!document.querySelector('.msg-results li:not(.direct)') && performance.now() - t < 15000) await new Promise((res) => setTimeout(res, 20))
    return performance.now() - t
  })
  r.search_screen_ms = Math.round(ts)
  await main.click('.subtabs.top button:has-text("Mensagens")')

  for (const k of Object.keys(r)) if (typeof r[k] === 'number') r[k] = Math.round(r[k] * 10) / 10
  console.log(JSON.stringify(r, null, 1))
  writeFileSync(join(outDir, 'perf.json'), JSON.stringify(r, null, 1))
}
