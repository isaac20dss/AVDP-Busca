// 11ª leva: botões Selos e Eras na lista de mensagens. Só lê. Uso: node tools/cdp.mjs tools/flow10.mjs <pasta>
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default async ({ main, shot }) => {
  const results = []
  const check = (name, ok, info = '') => {
    results.push(ok)
    console.log(`${ok ? 'OK ' : 'FALHOU'} ${name}${info ? ` — ${info}` : ''}`)
  }
  await main.waitForFunction(() => window.__avdp && document.querySelector('.tabs'), null, { timeout: 60000 })
  await main.evaluate(() => window.__avdp.getState().setModal(null))
  await main.click('.tabs button:nth-child(3)')
  await main.click('.subtabs.top button:has-text("Mensagens")')
  await main.fill('.msg-panel .panel-head input.search', '')
  const codes = () => main.$$eval('.msg-panel .result-list li .code, .msg-panel .result-list li b.code', (els) => els.map((e) => e.textContent.trim()))
  const lineCodes = () =>
    main.$$eval('.msg-panel .result-list li', (lis) => lis.map((li) => (li.textContent.match(/^(\d\d-\d{4}[A-Z]?|ERAS-\d\d)/) ?? [''])[0]).filter(Boolean))
  void codes

  await main.click('.msg-panel .collections button:has-text("Selos")')
  await sleep(600)
  const selos = await lineCodes()
  check('Botão Selos: só as 10 mensagens dos Selos, em ordem', selos.join(',') === '63-0317M,63-0317N,63-0318,63-0319,63-0320,63-0321,63-0322,63-0323,63-0324M,63-0324N', selos.join(','))
  await shot('40-selos')

  await main.click('.msg-panel .collections button:has-text("Eras")')
  await sleep(600)
  const eras = await lineCodes()
  check('Botão Eras: só os 10 capítulos do livro', eras.length === 10 && eras.every((c, i) => c === `ERAS-${String(i + 1).padStart(2, '0')}`), eras.join(','))
  await shot('41-eras')

  await main.click('.msg-panel .collections button:has-text("Eras")')
  await sleep(600)
  const all = await main.$eval('.msg-panel .list-meta span', (e) => e.textContent)
  check('Clicar de novo volta à lista toda', /^\d{3,}/.test(all.trim()), all.trim().slice(0, 40))

  const ok = results.filter(Boolean).length
  console.log(`\n${ok}/${results.length} verificações OK`)
}
