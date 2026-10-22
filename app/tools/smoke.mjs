// Roteiro rápido: abre cada aba e tira prints.
export default async ({ main, shot }) => {
  await main.setViewportSize?.({ width: 1600, height: 900 }).catch(() => {})
  await main.waitForTimeout(800)
  await shot('00-inicio')
  for (const [i, name] of ['letras', 'biblia', 'mensagens', 'textos'].entries()) {
    await main.keyboard.press('Escape')
    await main.click(`.tabs button:nth-child(${i + 1})`).catch(() => {})
    await main.waitForTimeout(500)
    await shot(`0${i + 1}-${name}`)
  }
}
