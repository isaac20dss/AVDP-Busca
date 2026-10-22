// Monta os slides de cada tipo de item.
import type { BookInfo, ChapterVerse, Item, Paragraph, Slide, Song, TextDoc } from '../types'

export interface SlideOptions {
  /** Máximo de linhas por slide nas letras (0 = parágrafo inteiro). */
  maxLines: number
  /** Primeiro slide com título e artista. */
  titleSlide: boolean
  /** Máximo de caracteres por slide em mensagens/textos (quando a divisão não é automática). */
  chunkChars: number
  /** Divide mensagens e textos pelo tamanho da letra do tema (quanto maior a letra, menos texto por slide). */
  autoChunk: boolean
  /** Pedaço com menos caracteres que isto vai junto com o vizinho no mesmo slide (calculado na hora; 0 = nunca). */
  mergeChars?: number
}

export const defaultSlideOptions: SlideOptions = { maxLines: 0, titleSlide: true, chunkChars: 420, autoChunk: true }

const LABEL_RE = /^\s*[[(]?\s*(refr[aã]o|coro|chorus|ponte|bridge|pr[eé]-?refr[aã]o|final|intro|verso|estrofe|parte)\b[^\n\]):]*[\])]?:?\s*$/i

/** Parágrafos da letra (separados por linha em branco), com etiqueta opcional. */
export function lyricParagraphs(lyrics: string): { label?: string; lines: string[] }[] {
  const blocks = lyrics.replace(/\r\n?/g, '\n').split(/\n\s*\n+/)
  const out: { label?: string; lines: string[] }[] = []
  for (const b of blocks) {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue
    let label: string | undefined
    if (LABEL_RE.test(lines[0]) && lines.length > 1) {
      label = lines.shift()!.replace(/[[\]():]/g, '').trim()
    }
    out.push({ label, lines })
  }
  return out
}

/** "1,2,3,2" -> índices 0-based válidos. */
export function parseOrder(order: string, count: number): number[] {
  const nums = order
    .split(/[\s,;]+/)
    .map((s) => parseInt(s, 10) - 1)
    .filter((n) => Number.isInteger(n) && n >= 0 && n < count)
  return nums.length ? nums : Array.from({ length: count }, (_, i) => i)
}

export function songSlides(song: Song, opt: SlideOptions): Slide[] {
  const paras = lyricParagraphs(song.lyrics)
  const order = parseOrder(song.paragraph_order, paras.length)
  const slides: Slide[] = []
  if (opt.titleSlide) {
    slides.push({ text: song.artist ? `${song.title}\n${song.artist}` : song.title, title: true, label: 'Título' })
  }
  // estrofes numeradas pela contagem de estrofes (o refrão não conta): "1, Refrão, 2"
  const stanza: number[] = []
  let n = 0
  for (const p of paras) stanza.push(p.label ? 0 : ++n)
  // rodapé (aparece se "Mostrar rodapé nas letras" estiver ligado)
  const footer = [song.title, song.artist || song.author, song.copyright].map((x) => (x ?? '').trim()).filter(Boolean).join(' · ')
  for (const idx of order) {
    const p = paras[idx]
    const chunks: string[][] = []
    if (opt.maxLines > 0 && p.lines.length > opt.maxLines) {
      for (let i = 0; i < p.lines.length; i += opt.maxLines) chunks.push(p.lines.slice(i, i + opt.maxLines))
    } else chunks.push(p.lines)
    chunks.forEach((lines, k) => {
      const base = p.label ?? `${stanza[idx]}`
      slides.push({ text: lines.join('\n'), label: chunks.length > 1 ? `${base} (${k + 1}/${chunks.length})` : base, footer: footer || undefined })
    })
  }
  return slides
}

export function songItem(song: Song, opt: SlideOptions): Item {
  return {
    kind: 'song',
    key: `song:${song.id}`,
    title: song.title,
    subtitle: song.artist,
    slides: songSlides(song, opt),
    themeId: song.theme_id,
    note: song.note || undefined,
    ref: { id: song.id },
  }
}

/** Quebra um texto longo em pedaços de até `max` caracteres, no fim de frases. */
export function chunkText(text: string, max: number): string[] {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return []
  if (t.length <= max) return [t]
  const sentences = t.match(/[^.!?…]+[.!?…]+["”’)]*\s*|[^.!?…]+$/g) ?? [t]
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim())
      cur = ''
    }
    if (s.length > max) {
      // frase gigante: corta por palavras
      const words = s.split(' ')
      for (const w of words) {
        if ((cur + ' ' + w).length > max && cur) {
          out.push(cur.trim())
          cur = ''
        }
        cur += (cur ? ' ' : '') + w
      }
    } else cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  // evita último pedaço minúsculo
  if (out.length > 1 && out[out.length - 1].length < max / 4) {
    const last = out.pop()!
    out[out.length - 1] += ' ' + last
  }
  return out
}

/**
 * Pedaços de um parágrafo para o telão: `chunkText` e, depois, o pedaço curto (menos de `merge`
 * caracteres, como um "3." sozinho) vai junto com o vizinho menor — só esse slide fica com a letra menor.
 */
export function paraChunks(text: string, max: number, merge = 0): string[] {
  const out = chunkText(text, max)
  while (merge > 0 && out.length > 1) {
    let k = -1
    for (let i = 0; i < out.length; i++) if (out[i].length < merge && (k < 0 || out[i].length < out[k].length)) k = i
    if (k < 0) break
    const prev = k > 0 ? out[k - 1].length : Infinity
    const next = k < out.length - 1 ? out[k + 1].length : Infinity
    if (prev <= next) out.splice(k - 1, 2, `${out[k - 1]} ${out[k]}`)
    else out.splice(k, 2, `${out[k]} ${out[k + 1]}`)
  }
  return out
}

/**
 * O texto de alguns parágrafos começa com o próprio número ("2. Eu espero…"): o número fica só no rodapé.
 * Vale também quando a numeração da fonte está deslocada (no Busca CBB o §7 pode começar com "5."),
 * até 40 atrás; número maior que o do parágrafo ou muito atrás (lista "1. … 2. …" no meio do texto) fica.
 */
export function paraText(text: string, num: number): string {
  if (num <= 0) return text
  const m = text.match(/^\s*(\d{1,4})\s*[.)]\s*/)
  if (!m) return text
  const n = +m[1]
  return n <= num && n >= num - 40 ? text.slice(m[0].length) : text
}

export const DEFAULT_MSG_FOOTER = '{codigo} · {titulo} · §{num}'
export const FOOTER_FIELDS = ['codigo', 'titulo', 'num', 'local', 'traducao'] as const
export type FooterInfo = { codigo: string; titulo: string; num: number; local?: string; traducao?: string }

/** Rodapé das mensagens pelo modelo ("{codigo} · {titulo} · §{num}"). Sem número (introdução), o "§{num}" sai. */
export function msgFooter(template: string, v: FooterInfo): string {
  let t = template.trim() || DEFAULT_MSG_FOOTER
  if (v.num <= 0) t = t.replace(/[^·|•{}]*\{num\}[^·|•{}]*/g, '')
  const vals: Record<string, string> = { codigo: v.codigo, titulo: v.titulo, num: v.num > 0 ? String(v.num) : '', local: v.local ?? '', traducao: v.traducao ?? '' }
  return t
    .replace(/\{(codigo|titulo|num|local|traducao)\}/g, (_, k: string) => vals[k])
    .replace(/([·|•])(\s*[·|•])+/g, '$1')
    .replace(/^[\s·|•–—-]+|[\s·|•–—-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
}

export function messageSlides(
  paras: Paragraph[],
  info: { code: string; title: string; local?: string; translation?: string; footer?: string },
  opt: SlideOptions,
): Slide[] {
  const slides: Slide[] = []
  for (const p of paras) {
    const parts = paraChunks(p.text, opt.chunkChars, opt.mergeChars ?? 0)
    const footer = msgFooter(info.footer ?? DEFAULT_MSG_FOOTER, { codigo: info.code, titulo: info.title, num: p.num, local: info.local, traducao: info.translation })
    parts.forEach((t, i) => {
      const n = p.num > 0 ? `§${p.num}` : 'intro'
      slides.push({
        text: t,
        label: parts.length > 1 ? `${n} (${i + 1}/${parts.length})` : n,
        footer,
      })
    })
  }
  return slides
}

export function textSlides(doc: TextDoc, opt: SlideOptions): Slide[] {
  const blocks = doc.body.replace(/\r\n?/g, '\n').split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean)
  const slides: Slide[] = []
  blocks.forEach((b, i) => {
    const isShort = b.length <= opt.chunkChars
    const parts = isShort ? [b] : paraChunks(b, opt.chunkChars, opt.mergeChars ?? 0)
    parts.forEach((t, k) => slides.push({ text: t, label: parts.length > 1 ? `${i + 1} (${k + 1}/${parts.length})` : `${i + 1}`, footer: doc.title }))
  })
  return slides
}

export function textItem(doc: TextDoc, opt: SlideOptions): Item {
  return { kind: 'text', key: `text:${doc.id}`, title: doc.title, subtitle: doc.source, slides: textSlides(doc, opt), ref: { id: doc.id } }
}

export interface VerseSlideOptions {
  /** Divide o versículo maior que isto em vários slides (0 = não divide). */
  splitChars?: number
  /** Mostra o começo do próximo versículo em letra menor. */
  peek?: boolean
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
/** 16 -> "¹⁶" (número do versículo dentro do texto). */
export const sup = (n: number) => String(n).replace(/\d/g, (d) => SUP[+d])

/** [4,5,6,7,9] -> "4-7, 9". */
export function rangeLabel(nums: number[]): string {
  const s = [...new Set(nums)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`)
    i = j
  }
  return out.join(', ')
}

/** Divide em partes parecidas (504 letras com limite 420 = 2 partes de ~250, não 420 + 84). */
function splitEven(text: string, max: number): string[] {
  const n = Math.ceil(text.length / max)
  const parts = chunkText(text, Math.ceil(text.length / n) + 24)
  return parts.length > 1 ? parts : [text]
}

const versionsTag = (abbrevs: string[]) => (abbrevs[0] ? ` (${abbrevs.join(' / ')})` : '')
const peekOf = (v: ChapterVerse | undefined) => {
  const t = v?.texts[0] ?? v?.texts.find(Boolean)
  if (!v || !t) return undefined
  const words = t.split(/\s+/)
  return `${sup(v.verse)} ${words.slice(0, 8).join(' ')}${words.length > 8 ? '…' : ''}`
}

/** Versículos de um capítulo (uma ou mais versões) -> slides (um por versículo, ou mais se for dividido). */
export function verseSlides(book: BookInfo, chapter: number, verses: ChapterVerse[], versionAbbrevs: string[], opt: VerseSlideOptions = {}): Slide[] {
  const out: Slide[] = []
  verses.forEach((v, i) => {
    const main = v.texts[0] ?? v.texts.find(Boolean) ?? ''
    const others = v.texts.slice(1).map((t, k) => (t ? { t, a: versionAbbrevs[k + 1] } : null)).filter(Boolean) as { t: string; a: string }[]
    const refText = `${book.name} ${chapter}:${v.verse}`
    const parts = opt.splitChars && main.length > opt.splitChars ? splitEven(main, opt.splitChars) : [main]
    parts.forEach((text, k) => {
      const last = k === parts.length - 1
      out.push({
        text,
        alt: last ? others.map((o) => `${o.t}  (${o.a})`).join('\n') : undefined,
        label: parts.length > 1 ? `v. ${v.verse} (${k + 1}/${parts.length})` : `v. ${v.verse}`,
        footer: refText + versionsTag(versionAbbrevs),
        refText,
        peek: opt.peek && last ? peekOf(verses[i + 1]) : undefined,
        ref: { book: book.id, chapter, verse: v.verse },
      })
    })
  })
  return out
}

/** Versículos escolhidos projetados juntos num slide (dividido se passar do limite). */
export function versesTogether(book: BookInfo, chapter: number, verses: ChapterVerse[], versionAbbrevs: string[], opt: VerseSlideOptions = {}): Slide[] {
  if (!verses.length) return []
  const joinText = (k: number) =>
    verses
      .map((v) => (v.texts[k] ? `${sup(v.verse)} ${v.texts[k]}` : ''))
      .filter(Boolean)
      .join(' ')
  const main = joinText(0)
  const alt = versionAbbrevs
    .slice(1)
    .map((a, k) => {
      const t = joinText(k + 1)
      return t ? `${t}  (${a})` : ''
    })
    .filter(Boolean)
    .join('\n')
  const refText = `${book.name} ${chapter}:${rangeLabel(verses.map((v) => v.verse))}`
  const refs = verses.map((v) => ({ book: book.id, chapter, verse: v.verse }))
  const parts = opt.splitChars && main.length > opt.splitChars ? splitEven(main, opt.splitChars) : [main]
  return parts.map((text, k) => ({
    text,
    alt: k === parts.length - 1 ? alt : undefined,
    label: parts.length > 1 ? `v. ${rangeLabel(verses.map((v) => v.verse))} (${k + 1}/${parts.length})` : `v. ${rangeLabel(verses.map((v) => v.verse))}`,
    footer: refText + versionsTag(versionAbbrevs),
    refText,
    ref: refs[0],
    refs,
  }))
}

/** "⟦x⟧" -> partes para destacar. */
export function splitMarked(s: string): { t: string; hit: boolean }[] {
  const out: { t: string; hit: boolean }[] = []
  const re = /⟦([^⟧]*)⟧/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index), hit: false })
    out.push({ t: m[1], hit: true })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ t: s.slice(last), hit: false })
  return out
}

export function holyricsId(book: number, chapter: number, verse: number) {
  return `${String(book).padStart(2, '0')}${String(chapter).padStart(3, '0')}${String(verse).padStart(3, '0')}`
}
