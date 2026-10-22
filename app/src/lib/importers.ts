// Importação de letras e textos: TXT, HTML, PDF, DOCX, PPTX, ODT, XML (EasySlides, OpenLyrics), JSON e texto colado.

export interface ImportedDoc {
  title: string
  artist: string
  text: string
  source: string
}

export const ACCEPTED = '.txt,.text,.md,.lrc,.htm,.html,.pdf,.docx,.pptx,.odt,.odp,.xml,.json,.csv'

const CHORD = /^[A-G](#|b)?(m|maj|min|dim|aug|sus|add|M)?\d*(\([^)]*\))?(\/[A-G](#|b)?)?$/

/** Linha só de cifras ("G  D/F#  Em  C") — removida quando pedido. */
export function isChordLine(line: string): boolean {
  const toks = line.trim().split(/\s+/).filter(Boolean)
  return toks.length > 0 && toks.every((t) => CHORD.test(t) || /^[|/\-–()x\d]+$/.test(t))
}

/** Normaliza quebras, apara linhas e junta blocos de linhas em branco. */
export function tidy(text: string, opts: { stripChords?: boolean } = {}): string {
  let lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[​﻿]/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
  if (opts.stripChords) lines = lines.filter((l) => !l || !isChordLine(l))
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Título e artista nas primeiras linhas ("Título\nArtista\n\nletra..."). */
export function splitHeader(text: string, fallbackTitle: string): { title: string; artist: string; body: string } {
  const t = tidy(text)
  const blocks = t.split(/\n\n/)
  const first = blocks[0]?.split('\n') ?? []
  if (blocks.length > 1 && first.length <= 2 && first[0] && first[0].length <= 70) {
    return { title: first[0], artist: first[1] ?? '', body: blocks.slice(1).join('\n\n') }
  }
  const title = (t.split('\n').find(Boolean) ?? fallbackTitle).slice(0, 80)
  return { title: title || fallbackTitle, artist: '', body: t }
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim()

function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('�')) return utf8
  return new TextDecoder('windows-1252').decode(buf)
}

// ---------- HTML ----------

const BLOCK = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'TR', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE'])

/** Texto do HTML preservando linhas (<br>) e estrofes (parágrafos/blocos). */
export function htmlToText(root: Element | Document): string {
  const out: string[] = []
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out.push((n.textContent ?? '').replace(/\s+/g, ' '))
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const el = n as Element
    const tag = el.tagName
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEADER', 'FOOTER', 'FORM', 'BUTTON', 'IFRAME', 'SVG'].includes(tag)) return
    if (tag === 'BR') {
      out.push('\n')
      return
    }
    const block = BLOCK.has(tag)
    if (block) out.push('\n\n')
    el.childNodes.forEach(walk)
    if (block) out.push('\n\n')
  }
  walk(root instanceof Document ? root.body : root)
  return out
    .join('')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Acha o miolo da página (letra, artigo) e o título. */
export function parseHtml(html: string, fileName: string): ImportedDoc {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const pick = [
    '.lyric-original', '.cnt-letra', '.letra', '.lyrics', '[class*="lyric"]', 'article .entry-content', '.entry-content',
    'article', 'main', '#content', '.content',
  ]
  let root: Element | null = null
  for (const sel of pick) {
    const el = doc.querySelector(sel)
    if (el && (el.textContent ?? '').trim().length > 80) {
      root = el
      break
    }
  }
  const h1 = doc.querySelector('h1')?.textContent?.trim()
  const pageTitle = doc.title?.split(/[|\-–]/)[0]?.trim()
  const artist = doc.querySelector('h2 a, .head-subtitle, [class*="artist"]')?.textContent?.trim() ?? ''
  const text = htmlToText(root ?? doc)
  return { title: h1 || pageTitle || baseName(fileName), artist: artist.slice(0, 60), text: tidy(text), source: fileName }
}

// ---------- PDF ----------

export async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  const pages: string[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    type It = { str: string; transform: number[]; height: number; hasEOL?: boolean }
    const items = (content.items as It[]).filter((i) => 'str' in i)
    // agrupa por linha (coordenada y)
    const lines: { y: number; h: number; parts: { x: number; s: string }[] }[] = []
    for (const it of items) {
      const y = it.transform[5]
      const x = it.transform[4]
      let line = lines.find((l) => Math.abs(l.y - y) < Math.max(2, (it.height || 10) * 0.4))
      if (!line) {
        line = { y, h: it.height || 10, parts: [] }
        lines.push(line)
      }
      line.parts.push({ x, s: it.str })
    }
    lines.sort((a, b) => b.y - a.y)
    const typical = median(lines.slice(1).map((l, i) => lines[i].y - l.y).filter((d) => d > 0)) || 14
    let text = ''
    lines.forEach((l, i) => {
      if (i > 0 && lines[i - 1].y - l.y > typical * 1.6) text += '\n'
      text += l.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join('').replace(/\s+/g, ' ').trim() + '\n'
    })
    pages.push(text)
  }
  return pages.join('\n')
}

function median(a: number[]): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

// ---------- Office ----------

async function docxToText(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buf })
  // cada <p> é uma linha; <p> vazio separa estrofes
  const doc = new DOMParser().parseFromString(value, 'text/html')
  const lines: string[] = []
  doc.body.querySelectorAll('p, h1, h2, h3, li').forEach((p) => {
    const t = (p.textContent ?? '').trim()
    lines.push(t)
  })
  return lines.join('\n')
}

async function zipXml(buf: ArrayBuffer) {
  const JSZip = (await import('jszip')).default
  return JSZip.loadAsync(buf)
}

async function pptxToText(buf: ArrayBuffer): Promise<string> {
  const zip = await zipXml(buf)
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]))
  const slides: string[] = []
  for (const n of names) {
    const xml = await zip.file(n)!.async('string')
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const paras = Array.from(doc.getElementsByTagName('a:p')).map((p) =>
      Array.from(p.getElementsByTagName('a:t')).map((t) => t.textContent ?? '').join(''),
    )
    const t = paras.map((s) => s.trim()).filter(Boolean).join('\n')
    if (t) slides.push(t)
  }
  return slides.join('\n\n')
}

async function odfToText(buf: ArrayBuffer): Promise<string> {
  const zip = await zipXml(buf)
  const xml = await zip.file('content.xml')!.async('string')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const ps = Array.from(doc.getElementsByTagName('*')).filter((e) => e.tagName === 'text:p' || e.tagName === 'text:h')
  return ps.map((p) => (p.textContent ?? '').trim()).join('\n')
}

// ---------- XML de outros programas ----------

function parseEasySlides(doc: Document, fileName: string): ImportedDoc[] {
  return Array.from(doc.getElementsByTagName('Item')).map((it) => {
    const get = (t: string) => it.getElementsByTagName(t)[0]?.textContent?.trim() ?? ''
    const contents = get('Contents')
      .replace(/^\s*\[chorus\]\s*$/gim, '\nRefrão')
      .replace(/^\s*\[bridge\]\s*$/gim, '\nPonte')
      .replace(/^\s*\[(\d+|prechorus|ending|intro)\]\s*$/gim, '\n')
    return { title: get('Title1') || baseName(fileName), artist: get('Writer') || get('Title2'), text: tidy(contents), source: fileName }
  })
}

function parseOpenLyrics(doc: Document, fileName: string): ImportedDoc[] {
  const title = doc.getElementsByTagName('title')[0]?.textContent?.trim() ?? baseName(fileName)
  const artist = doc.getElementsByTagName('author')[0]?.textContent?.trim() ?? ''
  const verses = Array.from(doc.getElementsByTagName('verse')).map((v) => {
    const name = v.getAttribute('name') ?? ''
    const lines = Array.from(v.getElementsByTagName('lines'))
      .map((l) => {
        const clone = l.cloneNode(true) as Element
        clone.querySelectorAll('br').forEach((b) => b.replaceWith('\n'))
        return (clone.textContent ?? '').trim()
      })
      .join('\n')
    return (name.toLowerCase().startsWith('c') ? 'Refrão\n' : '') + lines
  })
  const order = doc.getElementsByTagName('verseOrder')[0]?.textContent?.trim()
  void order
  return [{ title, artist, text: tidy(verses.join('\n\n')), source: fileName }]
}

function parseJson(text: string, fileName: string): ImportedDoc[] {
  const data = JSON.parse(text)
  const arr: Record<string, unknown>[] = Array.isArray(data) ? data : Array.isArray(data.songs) ? data.songs : [data]
  return arr
    .map((s) => ({
      title: String(s.title ?? s.titulo ?? s.name ?? baseName(fileName)),
      artist: String(s.artist ?? s.artista ?? s.author ?? ''),
      text: tidy(String(s.lyrics ?? s.letra ?? s.text ?? s.texto ?? '')),
      source: fileName,
    }))
    .filter((d) => d.text)
}

/** Lê um arquivo e devolve um ou mais documentos (músicas ou textos). */
export async function importFile(file: File): Promise<ImportedDoc[]> {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const buf = await file.arrayBuffer()
  const fromText = (text: string): ImportedDoc[] => {
    const h = splitHeader(text, baseName(file.name))
    return [{ title: h.title, artist: h.artist, text: h.body, source: file.name }]
  }
  switch (ext) {
    case 'pdf':
      return fromText(await pdfToText(buf))
    case 'docx':
      return fromText(await docxToText(buf))
    case 'pptx':
      return [{ title: baseName(file.name), artist: '', text: tidy(await pptxToText(buf)), source: file.name }]
    case 'odt':
    case 'odp':
      return fromText(await odfToText(buf))
    case 'htm':
    case 'html':
      return [parseHtml(decodeText(buf), file.name)]
    case 'xml': {
      const text = decodeText(buf)
      const doc = new DOMParser().parseFromString(text, 'application/xml')
      if (doc.getElementsByTagName('Easyslides').length) return parseEasySlides(doc, file.name)
      if (doc.getElementsByTagName('song').length && doc.getElementsByTagName('lyrics').length) return parseOpenLyrics(doc, file.name)
      return fromText(doc.documentElement.textContent ?? '')
    }
    case 'json':
      return parseJson(decodeText(buf), file.name)
    default:
      return fromText(decodeText(buf))
  }
}

/** Texto colado: vários itens separados por linha com "---" ou "===". */
export function importPasted(text: string): ImportedDoc[] {
  return text
    .split(/\n\s*(?:-{3,}|={3,})\s*\n/)
    .map((chunk) => splitHeader(chunk, 'Texto colado'))
    .filter((h) => h.body.trim())
    .map((h) => ({ title: h.title, artist: h.artist, text: h.body, source: 'colado' }))
}
