// Leitura de Bíblias em formatos abertos: Zefania XML, OSIS XML, USFX, JSON, CSV/TSV e VPL.
// (SQLite MyBible/EasySlides é lido no Rust pelo caminho do arquivo.)

export type VerseTuple = [number, number, number, string]

const USFM = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ')
const OSIS = 'Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev'.split(' ')

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Livro por código USFM/OSIS, número ou nome (PT/EN). */
export function makeBookResolver(books: { id: number; abbrev: string; name: string; name_en: string }[]) {
  const map = new Map<string, number>()
  books.forEach((b) => {
    map.set(fold(b.abbrev), b.id)
    map.set(fold(b.name), b.id)
    map.set(fold(b.name_en), b.id)
  })
  USFM.forEach((c, i) => map.set(fold(c), i + 1))
  OSIS.forEach((c, i) => map.set(fold(c), i + 1))
  map.set('jo', 43)
  return (s: string | number | null | undefined): number | null => {
    if (s == null) return null
    if (typeof s === 'number') return s >= 1 && s <= 66 ? s : null
    const t = s.trim()
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10)
      return n >= 1 && n <= 66 ? n : null
    }
    return map.get(fold(t)) ?? null
  }
}

type Resolver = ReturnType<typeof makeBookResolver>

function zefania(doc: Document, rb: Resolver): VerseTuple[] {
  const out: VerseTuple[] = []
  Array.from(doc.getElementsByTagName('BIBLEBOOK')).forEach((b) => {
    const book = rb(b.getAttribute('bnumber')) ?? rb(b.getAttribute('bname'))
    if (!book) return
    Array.from(b.getElementsByTagName('CHAPTER')).forEach((c) => {
      const ch = parseInt(c.getAttribute('cnumber') ?? '0', 10)
      Array.from(c.getElementsByTagName('VERS')).forEach((v) => {
        const vn = parseInt(v.getAttribute('vnumber') ?? '0', 10)
        const text = (v.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (ch && vn && text) out.push([book, ch, vn, text])
      })
    })
  })
  return out
}

function osis(xml: string, doc: Document, rb: Resolver): VerseTuple[] {
  const out: VerseTuple[] = []
  const push = (id: string, text: string) => {
    const [bk, c, v] = id.split('.')
    const book = rb(bk)
    const t = text.replace(/<note[\s\S]*?<\/note>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (book && t) out.push([book, parseInt(c, 10), parseInt(v, 10), t])
  }
  // formato com conteúdo dentro de <verse osisID="...">
  const vs = Array.from(doc.getElementsByTagName('verse')).filter((v) => v.getAttribute('osisID') && !v.getAttribute('sID'))
  if (vs.length) {
    vs.forEach((v) => {
      v.querySelectorAll('note').forEach((n) => n.remove())
      push(v.getAttribute('osisID')!.split(' ')[0], v.textContent ?? '')
    })
    if (out.length) return out
  }
  // formato com marcos sID/eID
  const re = /<verse[^>]*\bsID="([^"]+)"[^>]*osisID="([^"]+)"[^>]*\/>([\s\S]*?)<verse[^>]*\beID="\1"[^>]*\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) push(m[2].split(' ')[0], m[3])
  if (!out.length) {
    const re2 = /<verse[^>]*osisID="([^"]+)"[^>]*\bsID="([^"]+)"[^>]*\/>([\s\S]*?)<verse[^>]*\beID="\2"[^>]*\/>/g
    while ((m = re2.exec(xml))) push(m[1].split(' ')[0], m[3])
  }
  return out
}

function usfx(xml: string, rb: Resolver): VerseTuple[] {
  const out: VerseTuple[] = []
  const bookRe = /<book\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/book>/g
  let b: RegExpExecArray | null
  while ((b = bookRe.exec(xml))) {
    const book = rb(b[1])
    if (!book) continue
    let ch = 0
    const tokRe = /<c\s+id="(\d+)"\s*\/>|<v\s+id="(\d+)[^"]*"\s*\/>([\s\S]*?)(?=<ve\s*\/>|<v\s|<c\s|$)/g
    let t: RegExpExecArray | null
    while ((t = tokRe.exec(b[2]))) {
      if (t[1]) ch = parseInt(t[1], 10)
      else if (t[2] && ch) {
        const text = t[3].replace(/<f[\s\S]*?<\/f>|<x[\s\S]*?<\/x>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        if (text) out.push([book, ch, parseInt(t[2], 10), text])
      }
    }
  }
  return out
}

function fromJson(data: unknown, rb: Resolver): VerseTuple[] {
  const out: VerseTuple[] = []
  // formato [{abbrev|name, chapters: [[v1, v2], ...]}] (thiagobodruk/biblia)
  const arr = Array.isArray(data) ? data : (data as { books?: unknown[] })?.books
  if (Array.isArray(arr) && arr.length && typeof arr[0] === 'object' && arr[0] && 'chapters' in (arr[0] as object)) {
    arr.forEach((b, i) => {
      const bo = b as { abbrev?: string; name?: string; chapters: (string[] | { verses: { text: string }[] })[] }
      const book = rb(bo.abbrev ?? null) ?? rb(bo.name ?? null) ?? (arr.length === 66 ? i + 1 : null)
      if (!book) return
      bo.chapters.forEach((c, ci) => {
        const verses = Array.isArray(c) ? c : c.verses.map((v) => v.text)
        verses.forEach((t, vi) => t && out.push([book, ci + 1, vi + 1, String(t)]))
      })
    })
    return out
  }
  // formato plano [{book, chapter, verse, text}]
  if (Array.isArray(arr)) {
    arr.forEach((r) => {
      const o = r as Record<string, unknown>
      const book = rb((o.book ?? o.livro ?? o.book_number ?? o.b) as string | number)
      const ch = Number(o.chapter ?? o.capitulo ?? o.c)
      const v = Number(o.verse ?? o.versiculo ?? o.v)
      const t = String(o.text ?? o.texto ?? o.t ?? '')
      if (book && ch && v && t) out.push([book, ch, v, t])
    })
  }
  return out
}

function fromLines(text: string, rb: Resolver): VerseTuple[] {
  const out: VerseTuple[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  const sep = lines.slice(0, 20).some((l) => l.includes('\t')) ? '\t' : lines.slice(0, 20).every((l) => !l || l.split(';').length >= 4) ? ';' : ','
  for (const l of lines) {
    // VPL: "GEN 1:1 texto" ou "Gênesis 1:1 texto"
    const vpl = l.match(/^\s*((?:[1-3]\s?)?[^\d\s:]+)\s+(\d+):(\d+)\s+(.+)$/)
    if (vpl) {
      const book = rb(vpl[1])
      if (book) {
        out.push([book, +vpl[2], +vpl[3], vpl[4].trim()])
        continue
      }
    }
    const cols = l.split(sep)
    if (cols.length >= 4) {
      const book = rb(cols[0].replace(/"/g, ''))
      const ch = parseInt(cols[1], 10)
      const v = parseInt(cols[2], 10)
      const t = cols.slice(3).join(sep).replace(/^"|"$/g, '').trim()
      if (book && ch && v && t) out.push([book, ch, v, t])
    }
  }
  return out
}

/** Detecta o formato e devolve os versículos. */
export function parseBibleText(text: string, rb: Resolver): { verses: VerseTuple[]; name?: string; format: string } {
  const head = text.slice(0, 4000)
  if (/^\s*[[{]/.test(head)) return { verses: fromJson(JSON.parse(text), rb), format: 'JSON' }
  if (head.includes('<')) {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.getElementsByTagName('XMLBIBLE').length || doc.getElementsByTagName('BIBLEBOOK').length) {
      const name = doc.documentElement.getAttribute('biblename') ?? doc.getElementsByTagName('title')[0]?.textContent ?? undefined
      return { verses: zefania(doc, rb), name: name ?? undefined, format: 'Zefania XML' }
    }
    if (head.includes('<osis')) {
      const name = doc.getElementsByTagName('title')[0]?.textContent ?? undefined
      return { verses: osis(text, doc, rb), name: name ?? undefined, format: 'OSIS XML' }
    }
    if (head.includes('<usfx')) return { verses: usfx(text, rb), format: 'USFX' }
  }
  return { verses: fromLines(text, rb), format: 'texto/CSV' }
}

/** Versões livres do eBible.org que o app sabe baixar. */
export const EBIBLE_VERSIONS = [
  { id: 'porbrbsl', abbrev: 'BPM', name: 'Bíblia Portuguesa Mundial (2022)', license: 'Domínio público', language: 'pt' },
  { id: 'porbr2018', abbrev: 'BLIVRE', name: 'Bíblia Livre (2018)', license: 'Licença livre — Diego Santos, Mario Sérgio, Marco Teles (ver eBible.org)', language: 'pt' },
  { id: 'porblt', abbrev: 'BLT', name: 'Bíblia Livre Para Todos (2022)', license: 'Licença livre — Free Bible Ministry (ver eBible.org)', language: 'pt' },
  { id: 'poronbv', abbrev: 'NBV-O', name: 'Biblica Open Nova Bíblia Viva (2007)', license: 'Licença aberta — Biblica (ver eBible.org)', language: 'pt' },
  { id: 'eng-kjv2006', abbrev: 'KJV', name: 'King James Version', license: 'Domínio público', language: 'en' },
]
