// Fluxo principal: música colada, Bíblia por referência, busca de mensagens, leitor, projeção em janela.
export default async ({ main, shot, projection }) => {
  const inv = (cmd, args = {}) => main.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args])
  await main.keyboard.press('Escape')

  // música de teste (domínio público)
  const songs = await inv('songs_search', { query: '', opts: { mode: 'all', whole_word: false, variants: false, fuzzy: false, near: 10 }, sort: '' })
  if (!songs.total) {
    await inv('songs_import', {
      songs: [
        { title: 'Castelo Forte', artist: 'Martinho Lutero (Hinário)', lyrics: 'Castelo forte é nosso Deus\nEspada e bom escudo\nCom Seu poder defende os Seus\nEm todo transe agudo\n\nCom fúria pertinaz\nPersegue Satanás\nCom artimanhas tais\nE astúcias tão cruéis\nQue iguais não há na terra\n\nRefrão\nA nossa força nada faz\nEstamos, sim, perdidos\nMas nosso Deus socorro traz\nE somos protegidos' },
        { title: 'Grandioso És Tu', artist: 'Hinário', lyrics: 'Senhor meu Deus, quando eu maravilhado\nContemplo a Tua imensa criação\nO céu e a terra, os vastos oceanos\nFico a pensar em Tua perfeição\n\nRefrão\nEntão minh\'alma canta a Ti, Senhor\nGrandioso és Tu, grandioso és Tu' },
      ],
      onDuplicate: 'skip',
    })
  }
  await main.click('.tabs button:nth-child(1)')
  await main.fill('.panel input.search', 'contenplo')
  await main.waitForTimeout(500)
  await shot('20-letras-busca-aproximada')
  await main.keyboard.press('Enter')
  await main.waitForTimeout(400)
  await main.click('.slide-card >> nth=1')
  await main.waitForTimeout(400)
  await shot('21-letras-projetando')

  // Bíblia
  await main.click('.tabs button:nth-child(2)')
  await main.waitForTimeout(400)
  await main.fill('.bible-panel input.search', 'jo 3 16')
  await main.waitForTimeout(300)
  await main.keyboard.press('Enter')
  await main.waitForTimeout(800)
  await shot('30-biblia-jo3')
  await main.fill('.bible-panel input.search', 'loved the world')
  await main.keyboard.press('Enter')
  await main.waitForTimeout(800)
  await shot('31-biblia-pesquisa')

  // Mensagens
  await main.click('.tabs button:nth-child(3)')
  await main.waitForTimeout(500)
  await main.fill('.msg-panel input.search', 'sétimo selo')
  await main.waitForTimeout(900)
  await shot('40-msg-busca')
  await main.click('.msg-results li:not(.direct) >> nth=0')
  await main.waitForTimeout(900)
  await shot('41-msg-leitor')
  await main.click('.subtabs.top button:nth-child(2)')
  await main.waitForTimeout(600)
  await main.click('text=Várias traduções')
  await main.waitForTimeout(600)
  await main.click('.result-list li >> nth=0')
  await main.waitForTimeout(900)
  await shot('42-msg-varias-traducoes')

  // projeção em janela
  await inv('projection_open', { monitor: null })
  await main.waitForTimeout(1500)
  await main.dblclick('.reader-body .para >> nth=3')
  await main.waitForTimeout(800)
  const p = projection()
  if (p) await shot('50-projecao', p)
  else console.log('janela de projeção não encontrada')
  await shot('51-operador-ao-vivo')
}
