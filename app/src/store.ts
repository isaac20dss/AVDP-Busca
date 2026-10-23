// Estado do operador: aba, item aberto, ao vivo, temas, lista de reprodução, histórico, configurações.
import { emitTo } from '@tauri-apps/api/event'
import { create } from 'zustand'
import { api, errText, inTauri } from './api'
import type { HotkeyMap } from './lib/hotkeys'
import { DEFAULT_MSG_FOOTER, defaultSlideOptions, holyricsId, type SlideOptions } from './lib/slides'
import { parseTheme } from './lib/theme'
import type { BibleInfo, Blank, BookInfo, Item, ItemKind, LivePayload, PlaylistItem, Slide, Song, StagePayload, ThemeData, ThemeRow } from './types'

export type Tab = 'letras' | 'biblia' | 'mensagens' | 'textos' | 'midia'

export interface Settings {
  slide: SlideOptions
  themeByKind: Record<ItemKind, number | null>
  monitor: number | null
  fadeMs: number
  logoText: string
  /** Imagem do papel de parede (F8). Vazio = fundo do tema. */
  wallpaperImage: string
  bibleVersions: string[]
  /** Projetar a Bíblia pelo Holyrics (ACF, NVI, KJA… licenciadas dentro dele). */
  bibleViaHolyrics: boolean
  holyricsVersion: string
  /** Aba Imagens da biblioteca do Holyrics: no modo Holyrics as fotos dos slides vão para "AVDP ao vivo" dentro dela. */
  holyricsImageDir: string
  showSongFooter: boolean
  /** Abre a janela de projeção sozinha ao projetar. */
  autoOpenProjection: boolean
  hotkeys: HotkeyMap
  /** Monitor da tela de palco/retorno (null = em janela). */
  stageMonitor: number | null
  /** Trecho da Bíblia ("1co 13:4-7"): um slide por versículo ou todos juntos. */
  bibleRangeMode: 'sequencia' | 'juntos'
  /** Projeta só a referência ("João 3:16"), sem o texto. */
  bibleOnlyRef: boolean
  /** Divide versículo longo em mais de um slide. */
  bibleSplitLong: boolean
  /** Mostra o começo do próximo versículo em letra menor. */
  bibleShowNextStart: boolean
  /** Versões que o Ctrl+B percorre (vazio = as completas na língua da principal). */
  bibleCycle: string[]
  /** Leitor de mensagens: parágrafo inteiro ou dividido como vai para o telão (slides). */
  msgView: 'paragrafos' | 'slides'
  /** Modelo do rodapé das mensagens ("{codigo} · {titulo} · §{num}"). */
  msgFooter: string
  /** Ao abrir o programa, sincroniza as mensagens com Busca CBB e Tabernáculo da Fé (as editadas não mudam). */
  autoSync: boolean
}

const DEFAULT_SETTINGS: Settings = {
  slide: defaultSlideOptions,
  themeByKind: { song: null, verse: null, message: null, text: null, media: null },
  monitor: null,
  fadeMs: 300,
  logoText: '',
  wallpaperImage: '',
  bibleVersions: [],
  bibleViaHolyrics: false,
  holyricsVersion: '',
  holyricsImageDir: 'C:\\Holyrics\\Holyrics\\files\\media\\image',
  showSongFooter: false,
  autoOpenProjection: true,
  hotkeys: {},
  stageMonitor: null,
  bibleRangeMode: 'sequencia',
  bibleOnlyRef: false,
  bibleSplitLong: false,
  bibleShowNextStart: false,
  bibleCycle: [],
  msgView: 'paragrafos',
  msgFooter: DEFAULT_MSG_FOOTER,
  autoSync: false,
}

export type Modal =
  | null
  | { type: 'song'; song: Song }
  | { type: 'import'; target: 'song' | 'text' }
  | { type: 'settings'; tab?: string }
  | { type: 'theme'; theme: ThemeRow }
  | { type: 'search' }
  | { type: 'text'; id: number }

interface Toast {
  id: number
  text: string
  kind: 'info' | 'ok' | 'error'
}

interface Store {
  tab: Tab
  setTab: (t: Tab) => void
  /** Aberto pelo botão do módulo do Holyrics: só Mensagens e Bíblia, tudo projetado pelo Holyrics. */
  holyricsMode: boolean
  enterHolyricsMode: () => void
  settings: Settings
  saveSettings: (p: Partial<Settings>) => void
  themes: ThemeRow[]
  loadThemes: () => Promise<void>
  books: BookInfo[]
  bibles: BibleInfo[]
  loadBibles: () => Promise<void>

  item: Item | null
  /** Último item aberto em cada aba (volta ao trocar de aba). */
  tabItems: Partial<Record<Tab, Item | null>>
  /** Slide em destaque no centro (cursor do operador). */
  cursor: number
  openItem: (item: Item, cursor?: number) => void
  setCursor: (i: number) => void
  /** Itens abertos, para voltar/avançar (Ctrl+Shift+< e >). */
  history: Item[]
  historyIndex: number
  goHistory: (delta: number) => void

  live: Item | null
  liveIndex: number
  blank: Blank
  liveSeq: number
  /** O item ao vivo está sendo projetado pelo Holyrics (Bíblia licenciada). */
  liveViaHolyrics: boolean
  project: (item: Item, index: number) => void
  step: (delta: number) => void
  setBlank: (b: Blank) => void
  endPresentation: () => void
  liveTheme: () => ThemeData
  sendLive: () => void
  sendStage: () => void
  projectionOpen: boolean
  setProjectionOpen: (v: boolean) => void
  stageOpen: boolean
  setStageOpen: (v: boolean) => void

  playlistId: number | null
  playlist: PlaylistItem[]
  playlistIndex: number
  undo: PlaylistItem[][]
  redo: PlaylistItem[][]
  setPlaylist: (id: number | null, items: PlaylistItem[]) => void
  setPlaylistIndex: (i: number) => void
  addToPlaylist: (item: Item, label?: string, ref?: Record<string, unknown>) => void
  removeFromPlaylist: (i: number) => void
  movePlaylist: (from: number, to: number) => void
  undoPlaylist: () => void
  redoPlaylist: () => void

  modal: Modal
  setModal: (m: Modal) => void
  toasts: Toast[]
  toast: (text: string, kind?: Toast['kind'], ms?: number) => void
  fail: (e: unknown) => void
  /** Pedido de foco/recarga entre painéis (ex.: abrir mensagem pela busca global). */
  focusRequest: { kind: string; payload: unknown; at: number } | null
  request: (kind: string, payload: unknown) => void
}

let toastId = 1

/** Quem quer saber de cada projeção (ex.: histórico de versículos). */
const projectListeners: ((item: Item, index: number) => void)[] = []
export const onProject = (fn: (item: Item, index: number) => void) => {
  projectListeners.push(fn)
}

/** Quem continua depois do último slide (ex.: trecho da Bíblia segue no versículo seguinte). Devolve true se tratou. */
const edgeListeners: ((item: Item, delta: number) => boolean)[] = []
export const onStepPastEdge = (fn: (item: Item, delta: number) => boolean) => {
  edgeListeners.push(fn)
}

/** Música contada uma vez por dia em "mais tocadas" (não a cada volta para ela). */
const playedOn = new Map<number, string>()

/** O slide como vai para a tela: sem rodapé nas letras (se desligado) ou só a referência (Bíblia). */
export function displaySlide(item: Item | null, slide: Slide | null, s: Settings): Slide | null {
  if (!slide || !item) return slide
  if (item.kind === 'song' && !s.showSongFooter && !slide.title) return { ...slide, footer: undefined }
  if (item.kind === 'verse' && s.bibleOnlyRef && slide.refText) return { text: slide.refText, label: slide.label, ref: slide.ref, refs: slide.refs }
  return slide
}

export const KIND_TAB: Record<ItemKind, Tab> = { song: 'letras', verse: 'biblia', message: 'mensagens', text: 'textos', media: 'midia' }

/** Abas da janela aberta pelo Holyrics (como a janela Bíblia dele). */
export const HOLYRICS_TABS: Tab[] = ['mensagens', 'biblia']

export const useApp = create<Store>((set, get) => ({
  tab: 'letras',
  setTab: (tab) => {
    if (tab === get().tab) return
    if (get().holyricsMode && !HOLYRICS_TABS.includes(tab)) return
    set({ tab, item: get().tabItems[tab] ?? null, cursor: 0 })
  },
  holyricsMode: false,
  enterHolyricsMode: () => {
    set({ holyricsMode: true })
    if (!HOLYRICS_TABS.includes(get().tab)) get().setTab('mensagens')
    // a janela escondida da foto já fica pronta: a 1ª projeção não espera ela abrir (581 → ~80 ms)
    if (inTauri() && !get().projectionOpen) {
      set({ projectionOpen: true })
      api.captureOpen().catch(() => set({ projectionOpen: false }))
    }
    document.title = 'AVDP Busca — Holyrics'
  },
  settings: DEFAULT_SETTINGS,
  saveSettings: (p) => {
    const settings = { ...get().settings, ...p }
    set({ settings })
    if (inTauri()) api.setSetting('ui', JSON.stringify(settings)).catch(get().fail)
    get().sendLive()
  },
  themes: [],
  loadThemes: async () => set({ themes: await api.themesList() }),
  books: [],
  bibles: [],
  loadBibles: async () => {
    const [books, bibles] = await Promise.all([api.bibleBooks(), api.bibleList()])
    const s = get().settings
    let versions = s.bibleVersions.filter((v) => bibles.some((b) => b.id === v))
    if (!versions.length && bibles.length) {
      const pt = bibles.find((b) => b.language === 'pt') ?? bibles[0]
      versions = [pt.id]
    }
    set({ books, bibles })
    if (versions.join() !== s.bibleVersions.join()) get().saveSettings({ bibleVersions: versions })
  },

  item: null,
  tabItems: {},
  cursor: 0,
  history: [],
  historyIndex: -1,
  openItem: (item, cursor = 0) => {
    const tab = KIND_TAB[item.kind]
    const { history, historyIndex } = get()
    const cur = history[historyIndex]
    const nextHistory = cur?.key === item.key ? history : [...history.slice(0, historyIndex + 1), item].slice(-80)
    set({
      item: get().tab === tab ? item : get().item,
      cursor,
      tabItems: { ...get().tabItems, [tab]: item },
      history: nextHistory,
      historyIndex: nextHistory.length - 1,
    })
  },
  setCursor: (cursor) => set({ cursor }),
  goHistory: (delta) => {
    const { history, historyIndex } = get()
    const i = historyIndex + delta
    const it = history[i]
    if (!it) return
    const tab = KIND_TAB[it.kind]
    set({ historyIndex: i, tab, item: it, cursor: 0, tabItems: { ...get().tabItems, [tab]: it } })
  },

  live: null,
  liveIndex: 0,
  blank: 'none',
  liveSeq: 0,
  liveViaHolyrics: false,
  project: (item, index) => {
    const i = Math.max(0, Math.min(index, item.slides.length - 1))
    const s = get().settings
    const st = get()
    if (st.holyricsMode && item.kind === 'media') return st.fail('Mídia não vai pelo Holyrics: projete pelo próprio Holyrics.')
    // Bíblia licenciada do Holyrics (ACF, NVI…): vai a referência; o resto, no modo Holyrics, vai como foto
    // da projeção do AVDP (App.tsx, 'projection-painted')
    const viaHolyrics = item.kind === 'verse' && s.bibleViaHolyrics
    // A prévia (cursor) acompanha o ao vivo só quando estava junto dele (ou o item entra no ar agora).
    // Escolhida noutro slide, ela fica onde o operador pôs: prévia e ao vivo separados.
    const sameItem = st.item?.key === item.key
    const following = !st.live || st.live.key !== item.key || st.cursor === st.liveIndex
    // projetar um slide tira a tela preta / papel de parede / slide vazio
    set({ live: item, liveIndex: i, blank: 'none', liveSeq: st.liveSeq + 1, liveViaHolyrics: viaHolyrics, cursor: sameItem && following ? i : st.cursor })
    if (item.kind === 'song' && typeof item.ref.id === 'number' && inTauri()) {
      const today = new Date().toDateString()
      if (playedOn.get(item.ref.id) !== today) {
        playedOn.set(item.ref.id, today)
        api.songPlayed(item.ref.id).catch(() => {})
      }
    }
    for (const fn of projectListeners) fn(item, i)
    if (viaHolyrics) {
      const sl = item.slides[i]
      const refs = sl?.refs ?? (sl?.ref ? [sl.ref] : [])
      if (refs.length && inTauri()) api.holyricsShowVerse(refs.map((r) => holyricsId(r.book, r.chapter, r.verse)), s.holyricsVersion || undefined).catch(get().fail)
      get().sendStage()
      return
    }
    if ((st.holyricsMode || s.autoOpenProjection) && !get().projectionOpen && inTauri()) {
      set({ projectionOpen: true })
      ;(st.holyricsMode ? api.captureOpen() : api.projectionOpen(s.monitor)).catch((e) => {
        set({ projectionOpen: false })
        get().fail(e)
      })
    }
    get().sendLive()
  },
  step: (delta) => {
    const { live, liveIndex } = get()
    if (!live) return
    const n = liveIndex + delta
    if (n < 0 || n >= live.slides.length) {
      for (const fn of edgeListeners) if (fn(live, delta)) return
      return
    }
    get().project(live, n)
  },
  setBlank: (b) => {
    const next = get().blank === b ? 'none' : b
    set({ blank: next })
    if (get().liveViaHolyrics && inTauri()) {
      const action = b === 'logo' ? 'F8' : b === 'clear' ? 'F9' : 'F10'
      api.holyricsCall(`Set${action}`, { enable: next !== 'none' }).catch(get().fail)
      get().sendStage()
      return
    }
    get().sendLive()
  },
  endPresentation: () => {
    const via = get().liveViaHolyrics || get().holyricsMode
    set({ live: null, liveIndex: 0, blank: 'none', liveViaHolyrics: false })
    if (via && inTauri()) api.holyricsCall('CloseCurrentPresentation', {}).catch(get().fail)
    get().sendLive()
    // Esc para de projetar: depois do esmaecimento a janela de projeção fecha (abre de novo ao projetar);
    // no modo Holyrics ela fica (escondida) para a próxima foto sair logo
    if (inTauri() && get().projectionOpen && !get().holyricsMode) {
      const seq = get().liveSeq
      setTimeout(() => {
        const s = get()
        if (s.live || s.liveSeq !== seq || !s.projectionOpen) return
        set({ projectionOpen: false })
        api.projectionClose().catch(s.fail)
      }, get().settings.fadeMs + 60)
    }
  },
  liveTheme: () => {
    const { live, settings, themes } = get()
    const kind = live?.kind ?? 'song'
    const id = live?.themeId ?? settings.themeByKind[kind] ?? themes[0]?.id
    return parseTheme(themes.find((t) => t.id === id) ?? themes[0])
  },
  sendLive: () => {
    if (!inTauri()) return
    const { live, liveIndex, blank, settings, liveSeq, liveViaHolyrics } = get()
    const slide = live && !liveViaHolyrics ? live.slides[liveIndex] ?? null : null
    const theme = get().liveTheme()
    get().sendStage()
    const payload: LivePayload = {
      seq: liveSeq,
      slide: displaySlide(live, slide, settings),
      theme: blank === 'logo' && settings.wallpaperImage ? { ...theme, bg: { kind: 'image', image: settings.wallpaperImage, color: '#000' } } : theme,
      blank,
      logoText: settings.logoText,
      // modo Holyrics: a transição é do Holyrics; a foto sai do slide já pronto
      fadeMs: get().holyricsMode ? 0 : settings.fadeMs,
    }
    emitTo('projection', 'live', payload).catch(() => {})
  },
  sendStage: () => {
    if (!inTauri() || !get().stageOpen) return
    const { live, liveIndex, blank, settings } = get()
    const slide = live?.slides[liveIndex] ?? null
    const payload: StagePayload = {
      slide: displaySlide(live, slide, settings),
      next: displaySlide(live, live?.slides[liveIndex + 1] ?? null, settings),
      title: live?.title ?? '',
      label: slide?.label ?? '',
      position: live ? `${liveIndex + 1}/${live.slides.length}` : '',
      blank,
      note: live?.note ?? '',
    }
    emitTo('stage', 'stage', payload).catch(() => {})
  },
  projectionOpen: false,
  setProjectionOpen: (projectionOpen) => set({ projectionOpen }),
  stageOpen: false,
  setStageOpen: (stageOpen) => set({ stageOpen }),

  playlistId: null,
  playlist: [],
  playlistIndex: -1,
  undo: [],
  redo: [],
  setPlaylist: (playlistId, playlist) => set({ playlistId, playlist, playlistIndex: -1, undo: [], redo: [] }),
  setPlaylistIndex: (playlistIndex) => set({ playlistIndex }),
  addToPlaylist: (item, label, ref) => {
    const entry: PlaylistItem = {
      kind: item.kind,
      ref: JSON.stringify(ref ?? item.ref),
      label: label ?? (item.subtitle ? `${item.title} — ${item.subtitle}` : item.title),
    }
    changePlaylist([...get().playlist, entry])
    get().toast(`Adicionado à lista: ${entry.label}`, 'ok')
  },
  removeFromPlaylist: (i) => changePlaylist(get().playlist.filter((_, k) => k !== i)),
  movePlaylist: (from, to) => {
    const p = [...get().playlist]
    const [x] = p.splice(from, 1)
    p.splice(to, 0, x)
    changePlaylist(p)
  },
  undoPlaylist: () => {
    const { undo, playlist, redo } = get()
    if (!undo.length) return
    set({ playlist: undo[undo.length - 1], undo: undo.slice(0, -1), redo: [...redo, playlist] })
    persistPlaylist()
  },
  redoPlaylist: () => {
    const { undo, playlist, redo } = get()
    if (!redo.length) return
    set({ playlist: redo[redo.length - 1], redo: redo.slice(0, -1), undo: [...undo, playlist] })
    persistPlaylist()
  },

  modal: null,
  setModal: (modal) => set({ modal }),
  toasts: [],
  toast: (text, kind = 'info', ms) => {
    const id = toastId++
    set({ toasts: [...get().toasts, { id, text, kind }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), ms ?? (kind === 'error' ? 7000 : 3200))
  },
  fail: (e) => get().toast(errText(e), 'error'),
  focusRequest: null,
  request: (kind, payload) => set({ focusRequest: { kind, payload, at: Date.now() } }),
}))

function changePlaylist(next: PlaylistItem[]) {
  const { playlist, undo } = useApp.getState()
  useApp.setState({ playlist: next, undo: [...undo, playlist].slice(-50), redo: [] })
  persistPlaylist()
}

function persistPlaylist() {
  const { playlistId, playlist, fail } = useApp.getState()
  if (playlistId && inTauri()) api.playlistSetItems(playlistId, playlist).catch(fail)
}

export async function loadSettings() {
  const map = await api.getSettings()
  if (map.ui) {
    try {
      const s = JSON.parse(map.ui)
      useApp.setState({
        settings: {
          ...DEFAULT_SETTINGS,
          ...s,
          slide: { ...DEFAULT_SETTINGS.slide, ...s.slide },
          themeByKind: { ...DEFAULT_SETTINGS.themeByKind, ...s.themeByKind },
          hotkeys: { ...(s.hotkeys ?? {}) },
        },
      })
    } catch {
      /* configuração corrompida: usa o padrão */
    }
  }
  return map
}
