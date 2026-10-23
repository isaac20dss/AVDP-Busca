// Posição na Bíblia (livro/capítulo/versículo), o capítulo carregado, versículos escolhidos
// (trecho "1co 13:4-7" ou Ctrl/Shift+clique), favoritos e histórico de versículos projetados.
import { create } from 'zustand'
import { api, inTauri } from '../api'
import { chunkFor } from '../lib/fit'
import { rangeLabel, verseSlides, versesTogether, type VerseSlideOptions } from '../lib/slides'
import { onProject, onStepPastEdge, useApp } from '../store'
import type { BibleInfo, ChapterVerse, Item } from '../types'

/** Versículo (ou trecho) guardado nos favoritos ou no histórico. */
export interface BibleMark {
  book: number
  chapter: number
  verse: number
  /** Versículos escolhidos (trecho ou fora de sequência); vazio = só `verse`. */
  verses?: number[]
  /** Versão em que foi projetado (id). */
  bible?: string
  at?: number
}

interface BibleStore {
  book: number
  chapter: number
  verse: number | null
  verses: ChapterVerse[]
  /** Versões mostradas no capítulo atual (a primeira pode ser a reserva). */
  shown: string[]
  /** A versão escolhida não tem este livro (ex.: BPM ainda incompleta): mostra outra instalada no lugar. */
  fallback: { missing: string; using: string } | null
  /** A reserva é de outra língua: o Enter não projeta sozinho, espera confirmação. */
  needConfirm: boolean
  /** O operador já confirmou projetar a reserva noutra língua neste capítulo. */
  fallbackOk: boolean
  /** Reserva noutra língua ainda não confirmada: o Enter pede confirmação em vez de projetar. */
  blockedByLanguage: () => boolean
  loading: boolean
  /** Projetar o versículo assim que o capítulo carregar. */
  pendingProject: boolean
  /** Versículos escolhidos (2 ou mais = trecho; projetados juntos ou em sequência). */
  sel: number[]
  anchor: number | null
  go: (book: number, chapter: number, verse?: number | null, project?: boolean, verses?: number[]) => void
  load: () => Promise<void>
  /** Clique com Ctrl (soma/tira) ou Shift (do último ao clicado). */
  pick: (verse: number, mode: 'toggle' | 'range') => void
  clearSel: () => void
  /** Projeta os versículos escolhidos (ou o selecionado, se não houver trecho). */
  projectSelection: () => void
  confirmProject: () => void

  favs: BibleMark[]
  hist: BibleMark[]
  loadMarks: () => Promise<void>
  toggleFav: (m: BibleMark) => void
  removeHist: (i: number) => void
  clearHist: () => void
}

let loadSeq = 0

const sameMark = (a: BibleMark, b: BibleMark) =>
  a.book === b.book && a.chapter === b.chapter && (a.verses?.length ? a.verses.join() : String(a.verse)) === (b.verses?.length ? b.verses.join() : String(b.verse))

function saveMarks(key: 'bible_favs' | 'bible_hist', list: BibleMark[]) {
  if (inTauri()) api.setSetting(key, JSON.stringify(list)).catch(() => {})
}

export const useBible = create<BibleStore>((set, get) => ({
  book: 43,
  chapter: 3,
  verse: null,
  verses: [],
  shown: [],
  fallback: null,
  needConfirm: false,
  fallbackOk: false,
  loading: false,
  pendingProject: false,
  sel: [],
  anchor: null,
  go: (book, chapter, verse = null, project = false, verses = []) => {
    const same = book === get().book && chapter === get().chapter && get().verses.length > 0
    const sel = verses.length > 1 ? [...new Set(verses)].sort((a, b) => a - b) : []
    // capítulo novo: limpa na hora (mostra "Carregando…", nunca o capítulo anterior com o título novo)
    set({ book, chapter, verse, pendingProject: project, sel, anchor: verse, needConfirm: false, ...(same ? {} : { verses: [], loading: true, fallbackOk: false }) })
    if (same) afterLoad()
    else get().load()
  },
  load: async () => {
    const app = useApp.getState()
    const versions = app.settings.bibleVersions.filter((v) => app.bibles.some((b) => b.id === v))
    if (!versions.length) {
      set({ verses: [], shown: [], fallback: null })
      return
    }
    const { book, chapter } = get()
    const seq = ++loadSeq
    set({ loading: true })
    try {
      let shown = versions
      let verses = await api.bibleChapter(shown, book, chapter)
      let fallback: BibleStore['fallback'] = null
      if (!verses.some((v) => v.texts[0])) {
        // a versão escolhida não tem o livro: usa outra instalada (mesma língua primeiro), avisando no centro
        const lang = app.bibles.find((b) => b.id === versions[0])?.language
        const others = app.bibles.filter((b) => b.id !== versions[0]).sort((a, b) => Number(b.language === lang) - Number(a.language === lang))
        for (const b of others) {
          const tryShown = [b.id, ...versions.slice(1).filter((v) => v !== b.id)]
          const rows = await api.bibleChapter(tryShown, book, chapter)
          if (rows.some((v) => v.texts[0])) {
            shown = tryShown
            verses = rows
            fallback = { missing: versions[0], using: b.id }
            break
          }
        }
      }
      if (seq !== loadSeq) return
      set({ verses, shown, fallback })
      afterLoad()
    } catch (e) {
      app.fail(e)
    } finally {
      if (seq === loadSeq) set({ loading: false })
    }
  },
  pick: (verse, mode) => {
    const { sel, anchor } = get()
    const app = useApp.getState()
    // o versículo selecionado no centro (cursor) conta como ponto de partida
    const cur = app.item?.kind === 'verse' ? app.item.slides[app.cursor]?.ref?.verse : undefined
    const base = sel.length ? sel : cur != null ? [cur] : []
    let next: number[]
    if (mode === 'range') {
      const from = anchor ?? cur ?? verse
      const [a, b] = from < verse ? [from, verse] : [verse, from]
      next = Array.from({ length: b - a + 1 }, (_, i) => a + i)
    } else next = base.includes(verse) ? base.filter((v) => v !== verse) : [...base, verse]
    next = next.filter((v) => get().verses.some((x) => x.verse === v)).sort((a, b) => a - b)
    set({ sel: next.length > 1 ? next : [], anchor: mode === 'toggle' ? verse : anchor ?? verse })
    const item = chapterItem()
    const idx = item ? slideIndexOfVerse(item, next.length === 1 ? next[0] : verse) : -1
    if (idx >= 0) app.setCursor(idx)
  },
  clearSel: () => set({ sel: [], anchor: null }),
  projectSelection: () => {
    const app = useApp.getState()
    set({ needConfirm: false })
    if (get().sel.length > 1) {
      const it = selectionItem()
      if (it) app.project(it, 0)
      return
    }
    const item = chapterItem()
    if (item) app.project(item, app.item?.key === item.key ? app.cursor : 0)
  },
  blockedByLanguage: () => {
    const st = get()
    const app = useApp.getState()
    if (!st.fallback || st.fallbackOk || app.settings.bibleViaHolyrics) return false
    const primary = app.bibles.find((b) => b.id === app.settings.bibleVersions[0])
    const using = app.bibles.find((b) => b.id === st.fallback?.using)
    return !!primary && !!using && primary.language !== using.language
  },
  confirmProject: () => {
    const st = get()
    set({ needConfirm: false, fallbackOk: true })
    if (st.sel.length > 1) st.projectSelection()
    else {
      const item = chapterItem()
      const app = useApp.getState()
      if (item) app.project(item, app.item?.key === item.key ? app.cursor : 0)
    }
  },

  favs: [],
  hist: [],
  loadMarks: async () => {
    if (!inTauri()) return
    const map = await api.getSettings()
    const parse = (s?: string) => {
      try {
        return s ? (JSON.parse(s) as BibleMark[]) : []
      } catch {
        return []
      }
    }
    set({ favs: parse(map.bible_favs), hist: parse(map.bible_hist) })
  },
  toggleFav: (m) => {
    const favs = get().favs.some((f) => sameMark(f, m)) ? get().favs.filter((f) => !sameMark(f, m)) : [...get().favs, { ...m, at: Date.now() }]
    set({ favs })
    saveMarks('bible_favs', favs)
  },
  removeHist: (i) => {
    const hist = get().hist.filter((_, k) => k !== i)
    set({ hist })
    saveMarks('bible_hist', hist)
  },
  clearHist: () => {
    set({ hist: [] })
    saveMarks('bible_hist', [])
  },
}))

/** Opções de slide da Bíblia vindas das configurações. */
function verseOptions(): VerseSlideOptions {
  const s = useApp.getState().settings
  return { splitChars: s.bibleSplitLong ? chunkFor('verse') : 0, peek: s.bibleShowNextStart }
}

function abbrevsOf(shown: string[]) {
  const app = useApp.getState()
  return shown.map((v) => app.bibles.find((b) => b.id === v)?.abbrev ?? v)
}

/** Item do capítulo atual (um slide por versículo; mais de um se o versículo longo for dividido). */
export function chapterItem(): Item | null {
  const { book, chapter, verses, shown } = useBible.getState()
  const app = useApp.getState()
  const info = app.books.find((b) => b.id === book)
  if (!info || !verses.length) return null
  const abbrevs = abbrevsOf(shown)
  const o = verseOptions()
  return {
    kind: 'verse',
    key: `verse:${shown.join(',')}:${book}:${chapter}:${o.splitChars ? 's' : ''}${o.peek ? 'p' : ''}`,
    title: `${info.name} ${chapter}`,
    subtitle: abbrevs.join(' / '),
    slides: verseSlides(info, chapter, verses, abbrevs, o),
    ref: { book, chapter },
  }
}

/** Item só com os versículos escolhidos: juntos num slide ou um por slide, conforme a configuração. */
export function selectionItem(): Item | null {
  const { book, chapter, verses, shown, sel } = useBible.getState()
  const app = useApp.getState()
  const info = app.books.find((b) => b.id === book)
  const chosen = verses.filter((v) => sel.includes(v.verse))
  if (!info || chosen.length < 2) return null
  const abbrevs = abbrevsOf(shown)
  const o = verseOptions()
  const together = app.settings.bibleRangeMode === 'juntos'
  const range = `${info.name} ${chapter}:${rangeLabel(sel)}`
  return {
    kind: 'verse',
    key: `verse:${shown.join(',')}:${book}:${chapter}:sel:${sel.join('.')}:${together ? 'j' : 'q'}${o.splitChars ? 's' : ''}${o.peek ? 'p' : ''}`,
    title: range,
    subtitle: abbrevs.join(' / '),
    // "Só ref." num trecho: todos os slides mostram o trecho inteiro ("João 3:1-14"), não o versículo do slide
    slides: together ? versesTogether(info, chapter, chosen, abbrevs, o) : verseSlides(info, chapter, chosen, abbrevs, o).map((s) => ({ ...s, refText: range })),
    ref: { book, chapter, verses: sel },
  }
}

/** Primeiro slide do versículo no item (o versículo longo pode ter mais de um). */
export function slideIndexOfVerse(item: Item, verse: number): number {
  return item.slides.findIndex((s) => s.ref?.verse === verse || s.refs?.some((r) => r.verse === verse))
}

function afterLoad() {
  const st = useBible.getState()
  const item = chapterItem()
  if (!item) return
  const idx = st.verse ? Math.max(0, slideIndexOfVerse(item, st.verse)) : 0
  const app = useApp.getState()
  app.openItem(item, idx)
  if (!st.pendingProject) return
  useBible.setState({ pendingProject: false })
  // reserva noutra língua (ex.: inglês no lugar da BPM): não projeta sem o operador confirmar
  if (st.blockedByLanguage()) {
    useBible.setState({ needConfirm: true })
    return
  }
  if (st.sel.length > 1) st.projectSelection()
  else app.project(item, idx)
}

// histórico: cada versículo (ou trecho) projetado vai para o topo, sem repetir, até 40
onProject((item, index) => {
  if (item.kind !== 'verse') return
  const s = item.slides[index]
  if (!s?.ref) return
  const st = useBible.getState()
  const verses = s.refs && s.refs.length > 1 ? s.refs.map((r) => r.verse) : (item.ref.verses as number[] | undefined)
  const m: BibleMark = { book: s.ref.book, chapter: s.ref.chapter, verse: s.ref.verse, verses: verses && verses.length > 1 ? verses : undefined, bible: st.shown[0], at: Date.now() }
  const hist = [m, ...st.hist.filter((h) => !sameMark(h, m))].slice(0, 40)
  useBible.setState({ hist })
  saveMarks('bible_hist', hist)
})

/** Versões que o Ctrl+B percorre: as marcadas em Configurações → Bíblias, ou as completas na língua da principal. */
export function cycleVersions(): BibleInfo[] {
  const app = useApp.getState()
  const chosen = app.settings.bibleCycle.map((id) => app.bibles.find((b) => b.id === id)).filter(Boolean) as BibleInfo[]
  if (chosen.length) return chosen
  const lang = app.bibles.find((b) => b.id === app.settings.bibleVersions[0])?.language ?? 'pt'
  const complete = app.bibles.filter((b) => b.language === lang && b.verses >= 31000)
  return complete.length >= 2 ? complete : app.bibles
}

/** Põe a versão como principal (as do lado a lado continuam). */
export function setPrimaryVersion(id: string) {
  const app = useApp.getState()
  const versions = app.settings.bibleVersions
  const b = app.bibles.find((x) => x.id === id)
  if (!b) return
  app.saveSettings({ bibleVersions: [id, ...versions.slice(1).filter((v) => v !== id)] })
  app.toast(`Versão: ${b.abbrev}`, 'info')
}

/** Ctrl+B: próxima das versões marcadas. */
export function nextVersion() {
  const cyc = cycleVersions()
  if (cyc.length < 2) return
  const i = cyc.findIndex((b) => b.id === useApp.getState().settings.bibleVersions[0])
  setPrimaryVersion(cyc[(i + 1) % cyc.length].id)
}

/** Ctrl+Alt+1/2/3: direto à 1ª/2ª/3ª versão marcada. */
export function versionAt(i: number) {
  const b = cycleVersions()[i]
  if (b) setPrimaryVersion(b.id)
}

/** Depois de um trecho (ou antes dele), o capítulo e o slide para continuar a leitura. */
export function continuation(item: Item, delta: number): { chapter: Item; index: number } | null {
  const verses = item.ref.verses as number[] | undefined
  if (item.kind !== 'verse' || !verses?.length) return null
  const st = useBible.getState()
  if (st.book !== item.ref.book || st.chapter !== item.ref.chapter) return null
  const chapter = chapterItem()
  if (!chapter) return null
  const target = delta > 0 ? Math.max(...verses) + 1 : Math.min(...verses) - 1
  const index = slideIndexOfVerse(chapter, target)
  return index >= 0 ? { chapter, index } : null
}

// → no fim de um trecho segue no versículo seguinte do capítulo (← antes do começo volta ao anterior)
onStepPastEdge((item, delta) => {
  const c = continuation(item, delta)
  if (!c) return false
  useBible.setState({ sel: [], anchor: null })
  const app = useApp.getState()
  app.openItem(c.chapter, c.index)
  app.project(c.chapter, c.index)
  return true
})

/** "João 3:16" ou "1 Coríntios 13:4-7". */
export function markLabel(m: BibleMark): string {
  const books = useApp.getState().books
  const name = books.find((b) => b.id === m.book)?.name ?? `Livro ${m.book}`
  return `${name} ${m.chapter}:${m.verses?.length ? rangeLabel(m.verses) : m.verse}`
}
