// Quantos caracteres cabem num slide com o tema escolhido (fonte, tamanho, entrelinha, margens):
// a divisão de mensagens e textos acompanha o tamanho da letra, para o texto não encolher no telão.
import { useApp } from '../store'
import type { ItemKind, ThemeData } from '../types'
import type { SlideOptions } from './slides'
import { margins, parseTheme, textStyle } from './theme'

// texto de amostra em português (tamanho médio de palavra parecido com o das mensagens)
const SAMPLE = (
  'E agora, quando olhamos para a Palavra, nós vemos que Deus sempre teve um caminho preparado para o Seu povo. ' +
  'Ele nunca deixou a igreja sem uma direção, e cada vez que o povo se desviou, Ele levantou alguém para trazer a Palavra de volta. ' +
  'Não é uma coisa nova, é a mesma promessa desde o princípio, e nós cremos nisso de todo o coração. ' +
  'Veja, o homem pode mudar as suas ideias, as organizações podem mudar os seus credos, mas a Palavra de Deus permanece para sempre. ' +
  'Assim, esta noite, eu quero que vocês prestem atenção ao que está escrito aqui, porque isto é muito importante para nós. ' +
  'Quantos já leram esta passagem antes? Muitos de vocês. Muito bem. Então vamos ler outra vez, devagar, e ver o que Ele está dizendo. '
).repeat(6)

const REF_H = 900
const REF_W = 1600
const cache = new Map<string, number>()

/** Fonte do tema ainda carregando: a medida sairia com a fonte reserva. */
const fontReady = (t: ThemeData) => typeof document === 'undefined' || document.fonts.check(`${t.bold ? 700 : 400} 1em "${t.font}"`)

/** Caracteres que cabem num slide (16:9) com o tema, com folga para a quebra nas frases. */
export function fitChars(t: ThemeData): number {
  const m = margins(t)
  const key = JSON.stringify([t.font, t.size, t.bold, t.italic, t.uppercase, t.lineHeight, m, t.band, t.outline, t.footer.show, t.footer.size])
  const hit = cache.get(key)
  if (hit) return hit
  const footerH = t.footer.show ? (t.footer.size * 1.6 * REF_H) / 100 : 0
  const boxH = REF_H - footerH - ((m.top + m.bottom) * REF_H) / 100
  const boxW = REF_W - (2 * m.side * REF_H) / 100
  let best: number
  if (typeof document === 'undefined') {
    // sem tela para medir: estimativa pela área (letra média ~0,55 da altura)
    const px = (t.size * REF_H) / 100
    best = Math.floor(boxH / (px * t.lineHeight)) * Math.floor(boxW / (px * 0.55))
  } else {
    const el = document.createElement('div')
    const st = textStyle(t) as Record<string, string | number | undefined>
    for (const [k, v] of Object.entries(st)) if (v !== undefined) (el.style as unknown as Record<string, string>)[k] = String(v)
    Object.assign(el.style, {
      position: 'fixed',
      left: '-30000px',
      top: '0',
      visibility: 'hidden',
      width: `${boxW}px`,
      fontSize: `${(t.size * REF_H) / 100}px`,
      overflowWrap: 'break-word',
      padding: t.band ? '0.35em 0.7em' : '0',
      boxSizing: 'border-box',
    })
    document.body.appendChild(el)
    const fits = (n: number) => {
      el.textContent = SAMPLE.slice(0, n)
      return el.scrollHeight <= boxH
    }
    let lo = 1
    let hi = SAMPLE.length
    if (fits(hi)) lo = hi
    else
      while (hi - lo > 4) {
        const mid = (lo + hi) >> 1
        if (fits(mid)) lo = mid
        else hi = mid
      }
    el.remove()
    best = lo
  }
  // folga: a divisão é no fim das frases e o último pedaço pequeno se junta ao anterior
  const n = Math.max(12, Math.min(2000, Math.floor(best * 0.85)))
  if (fontReady(t)) cache.set(key, n)
  return n
}

/** Tema usado por um tipo de item (o escolhido em "Tema usado em…", senão o primeiro). */
export function themeFor(kind: ItemKind): ThemeData {
  const s = useApp.getState()
  const id = s.settings.themeByKind[kind] ?? s.themes[0]?.id
  return parseTheme(s.themes.find((t) => t.id === id) ?? s.themes[0])
}

/** Caracteres por slide para o tipo: automático pelo tamanho da letra do tema, ou o número fixo das Configurações. */
export function chunkFor(kind: ItemKind): number {
  const s = useApp.getState().settings.slide
  return s.autoChunk ? fitChars(themeFor(kind)) : s.chunkChars
}

/** Tolerância automática: pedaço com menos de 35% do que cabe num slide vai junto com o vizinho. */
export const autoMerge = (chunk: number) => Math.round(chunk * 0.35)

/** Caracteres por slide de um tema (automático pela letra, ou o número fixo das Configurações). */
export function chunkOfTheme(t: ThemeData): number {
  const s = useApp.getState().settings.slide
  return s.autoChunk ? fitChars(t) : s.chunkChars
}

/** Tolerância do tipo: a do tema (se ajustada à mão) ou a automática. */
export function mergeFor(kind: ItemKind): number {
  const t = themeFor(kind)
  return t.mergeChars ?? autoMerge(chunkFor(kind))
}

/** Opções de slide com a divisão já calculada para o tipo. */
export function slideOptsFor(kind: ItemKind): SlideOptions {
  return { ...useApp.getState().settings.slide, chunkChars: chunkFor(kind), mergeChars: mergeFor(kind) }
}

/** Carrega as fontes dos temas antes de medir (as letras vêm do próprio app, é rápido). */
export async function preloadThemeFonts() {
  if (typeof document === 'undefined') return
  const fonts = new Set(useApp.getState().themes.map((t) => parseTheme(t).font))
  await Promise.all([...fonts].flatMap((f) => [`400 1em "${f}"`, `700 1em "${f}"`].map((x) => document.fonts.load(x).catch(() => []))))
}
