import { listen } from '@tauri-apps/api/event'
import { createElement, lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { api, inTauri } from './api'
import { BibleCenter } from './components/BibleCenter'
import { BiblePanel } from './components/BiblePanel'
import { LivePanel } from './components/LivePanel'
import { MediaCenter, MediaPanel } from './components/MediaPanel'
import { MessageReader } from './components/MessageReader'
import { MessagesPanel } from './components/MessagesPanel'
import { PlaylistPanel } from './components/PlaylistPanel'
import { PreviewPanel } from './components/PreviewPanel'
import { SlidesView } from './components/SlidesView'
import { SongsPanel } from './components/SongsPanel'
import { TextsPanel } from './components/TextsPanel'
import { Toasts } from './components/Toasts'
import { TopBar } from './components/TopBar'
import { AudioPlayer } from './components/AudioPlayer'
import { preloadThemeFonts } from './lib/fit'
import { CTRL_KEY, comboFromEvent, effectiveMap, type ActionId } from './lib/hotkeys'
import { addCurrentToPlaylist, editCurrent, openPlaylistItem, projectPreview } from './lib/open'
import { nextVersion, versionAt } from './state/bible'
import { loadSettings, useApp, type Tab } from './store'

/**
 * Janela que só abre quando pedida: carrega à parte (o app abre mais rápido) e é buscada em segundo plano
 * logo depois da abertura. Já baixada, desenha direto — sem Suspense, que no React 19 segura ~300 ms.
 */
function lazyPreload<P extends object>(load: () => Promise<ComponentType<P>>) {
  let ready: ComponentType<P> | null = null
  const preload = () =>
    load().then((c) => {
      ready = c
      return c
    })
  const Lazy = lazy(() => preload().then((c) => ({ default: c })))
  const Comp = (props: P) => (ready ? createElement(ready, props) : createElement(Lazy, props))
  return Object.assign(Comp, { preload })
}
const SettingsDialog = lazyPreload(() => import('./components/SettingsDialog').then((m) => m.SettingsDialog))
const ThemeEditor = lazyPreload(() => import('./components/ThemeEditor').then((m) => m.ThemeEditor))
const SongEditor = lazyPreload(() => import('./components/SongEditor').then((m) => m.SongEditor))
const TextEditor = lazyPreload(() => import('./components/TextEditor').then((m) => m.TextEditor))
const ImportDialog = lazyPreload(() => import('./components/ImportDialog').then((m) => m.ImportDialog))
const GlobalSearch = lazyPreload(() => import('./components/GlobalSearch').then((m) => m.GlobalSearch))
const Welcome = lazyPreload(() => import('./components/Welcome').then((m) => m.Welcome))

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

const TAB_ACTIONS: Partial<Record<ActionId, Tab>> = {
  tabLetras: 'letras',
  tabBiblia: 'biblia',
  tabMensagens: 'mensagens',
  tabTextos: 'textos',
  tabMidia: 'midia',
}

/** Ctrl + setas escolhem o slide; ao soltar o Ctrl ele é projetado (como no Holyrics). */
let pendingCtrlProject = false

function run(action: ActionId) {
  const s = useApp.getState()
  const tab = TAB_ACTIONS[action]
  if (tab) return s.setTab(tab)
  switch (action) {
    case 'next':
    case 'prev': {
      const d = action === 'next' ? 1 : -1
      if (s.live) s.step(d)
      else if (s.item) s.setCursor(Math.max(0, Math.min(s.cursor + d, s.item.slides.length - 1)))
      return
    }
    case 'first':
      if (s.live) s.project(s.live, 0)
      return
    case 'last':
      if (s.live) s.project(s.live, s.live.slides.length - 1)
      return
    case 'cursorNext':
    case 'cursorPrev':
      if (s.item) {
        s.setCursor(Math.max(0, Math.min(s.cursor + (action === 'cursorNext' ? 1 : -1), s.item.slides.length - 1)))
        pendingCtrlProject = true
      }
      return
    case 'projectSelected':
      // a prévia vai ao ar; na Bíblia, com versículos escolhidos (trecho / Ctrl+clique), o trecho
      return projectPreview()
    case 'projectFromStart':
      if (s.item) s.project(s.item, 0)
      return
    case 'wallpaper':
      return s.setBlank('logo')
    case 'blank':
      return s.setBlank('clear')
    case 'black':
      return s.setBlank('black')
    case 'exit':
      return s.endPresentation()
    case 'toggleProjection': {
      const open = !s.projectionOpen
      ;(open ? api.projectionOpen(s.settings.monitor) : api.projectionClose()).then(() => s.setProjectionOpen(open)).catch(s.fail)
      return
    }
    case 'toggleStage': {
      const open = !s.stageOpen
      ;(open ? api.stageOpen(s.settings.stageMonitor) : api.stageClose()).then(() => s.setStageOpen(open)).catch(s.fail)
      return
    }
    case 'searchPanel':
      return s.request('focus-search', s.tab)
    case 'searchNarrow':
      return s.request('search-narrow', s.tab)
    case 'searchGlobal':
      return s.setModal({ type: 'search' })
    case 'historyBack':
      return s.goHistory(-1)
    case 'historyForward':
      return s.goHistory(1)
    case 'editItem':
      return editCurrent()
    case 'addToPlaylist':
      return addCurrentToPlaylist()
    case 'playlistNext':
    case 'playlistPrev':
      return openPlaylistItem(s.playlistIndex + (action === 'playlistNext' ? 1 : -1))
    case 'playlistUndo':
      return s.undoPlaylist()
    case 'playlistRedo':
      return s.redoPlaylist()
    case 'bibleNextVersion':
      // versões do Holyrics: a lista vem do próprio Holyrics (painel da Bíblia); as do AVDP trocam direto
      return s.settings.bibleViaHolyrics ? s.request('bible-next-version', null) : nextVersion()
    case 'bibleVersion1':
    case 'bibleVersion2':
    case 'bibleVersion3':
      return versionAt(+action.slice(-1) - 1)
    case 'mediaPlayPause':
      return s.request('media-cmd', 'toggle')
    case 'mediaStop':
      return s.request('media-cmd', 'stop')
  }
}

const GLOBAL_ACTIONS = new Set<ActionId>([
  'projectFromStart', 'wallpaper', 'blank', 'black', 'toggleProjection', 'toggleStage', 'searchPanel', 'searchNarrow', 'searchGlobal',
  'tabLetras', 'tabBiblia', 'tabMensagens', 'tabTextos', 'tabMidia', 'historyBack', 'historyForward', 'addToPlaylist',
  'playlistNext', 'playlistPrev', 'bibleNextVersion', 'mediaPlayPause', 'mediaStop',
])
const IN_MODAL = new Set<ActionId>(['wallpaper', 'blank', 'black'])

/** Ao abrir: "Sincronizar automaticamente" ligado baixa o que é novo no Tabernáculo da Fé e no Busca CBB
 * (as traduções editadas não são sobrescritas); desligado, só avisa se há novidade online. Sem internet, quieto. */
async function startupSync(map: Record<string, string>) {
  const s = useApp.getState()
  // AVDP Busca e AVDP Busca Plugin usam o mesmo banco: o que abrir logo depois do outro não repete
  const recent = Date.now() / 1000 - Math.max(+(map.tdf_synced_at ?? 0), +(map.cbb_synced_at ?? 0)) < 30 * 60
  try {
    if (s.settings.autoSync) {
      if (recent) return
      const tdf = await api.msgSyncTdf()
      const cbb = await api.msgSyncCbb()
      s.request('msg-data-changed', null)
      if (tdf.downloaded > 0) s.toast(`Mensagens sincronizadas: ${tdf.downloaded} novas ou revisadas do Tabernáculo da Fé · Busca CBB conferido (${cbb})`, 'ok', 8000)
      return
    }
    const p = await api.msgOnlinePending()
    const n = p.tdf + p.cbb
    if (n > 0)
      s.toast(`Há ${n} mensagens novas ou revisadas online (Tabernáculo da Fé ${p.tdf}, Busca CBB ${p.cbb}). Sincronize em Configurações → Mensagens ou ligue "Sincronizar automaticamente".`, 'info', 12000)
  } catch {
    /* sem internet ou site fora do ar: tenta na próxima abertura */
  }
}

export default function App() {
  const tab = useApp((s) => s.tab)
  const modal = useApp((s) => s.modal)
  const hotkeys = useApp((s) => s.settings.hotkeys)
  const [ready, setReady] = useState(!inTauri())
  const [firstRun, setFirstRun] = useState(false)

  useEffect(() => {
    if (!inTauri()) return
    ;(async () => {
      try {
        const map = await loadSettings()
        const st = useApp.getState()
        await Promise.all([st.loadThemes(), st.loadBibles()])
        // as fontes dos temas medem quanto texto cabe por slide (divisão pelo tamanho da letra)
        await preloadThemeFonts()
        if (!map.welcome_done) await Welcome.preload().catch(() => null)
        setFirstRun(!map.welcome_done)
      } catch (e) {
        useApp.getState().fail(e)
      } finally {
        setReady(true)
        // busca as janelas em segundo plano (depois da tela pronta)
        setTimeout(() => {
          for (const c of [GlobalSearch, SettingsDialog, ThemeEditor, SongEditor, TextEditor, ImportDialog]) c.preload().catch(() => {})
        }, 1500)
        // sincronização/aviso depois da tela pronta (não atrasa a abertura)
        setTimeout(() => api.getSettings().then(startupSync).catch(() => {}), 4000)
      }
    })()
    // a janela de projeção pede o slide atual quando abre
    const un = listen('projection-ready', () => {
      useApp.getState().setProjectionOpen(true)
      useApp.getState().sendLive()
    })
    const unClosed = listen('projection-closed', () => useApp.getState().setProjectionOpen(false))
    // tela de palco: pede o estado atual quando abre
    const unStage = listen('stage-ready', () => {
      useApp.getState().setStageOpen(true)
      useApp.getState().sendStage()
    })
    const unStageClosed = listen('stage-closed', () => useApp.getState().setStageOpen(false))
    // aberto pelo botão "AVDP Busca" do módulo do Holyrics (já aberto: o plugin single-instance avisa)
    api.holyricsMode().then((on) => on && useApp.getState().enterHolyricsMode()).catch(() => {})
    const unHolyrics = listen('holyrics-mode', () => useApp.getState().enterHolyricsMode())
    // modo Holyrics: cada slide pintado na projeção (escondida) vira foto no Holyrics; uma por vez,
    // e se outro chegou no meio, tira de novo no fim
    let busy = false
    let again = false
    const unPainted = listen('projection-painted', async () => {
      const s = useApp.getState()
      if (!s.holyricsMode || !s.live || s.liveViaHolyrics) return
      if (busy) {
        again = true
        return
      }
      busy = true
      try {
        do {
          again = false
          await api.holyricsShowCapture(useApp.getState().settings.holyricsImageDir)
        } while (again)
      } catch (e) {
        useApp.getState().fail(e)
      } finally {
        busy = false
      }
    })
    return () => {
      unPainted.then((f) => f())
      unHolyrics.then((f) => f())
      un.then((f) => f())
      unClosed.then((f) => f())
      unStage.then((f) => f())
      unStageClosed.then((f) => f())
    }
  }, [])

  // atalhos (Configurações → Atalhos)
  useEffect(() => {
    const map = effectiveMap(hotkeys)
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e)
      if (!combo) return
      const action = map.get(combo)
      if (!action) return
      const s = useApp.getState()
      if (s.modal && !IN_MODAL.has(action) && !(action === 'searchGlobal' && s.modal.type === 'search')) return
      if (isTyping(e) && !GLOBAL_ACTIONS.has(action)) return
      e.preventDefault()
      e.stopPropagation()
      run(action)
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === CTRL_KEY && pendingCtrlProject) {
        pendingCtrlProject = false
        const s = useApp.getState()
        if (s.item) s.project(s.item, s.cursor)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
    }
  }, [hotkeys])

  if (!ready) return <div className="loading">Carregando…</div>

  const left =
    tab === 'letras' ? <SongsPanel /> : tab === 'biblia' ? <BiblePanel /> : tab === 'mensagens' ? <MessagesPanel /> : tab === 'midia' ? <MediaPanel /> : <TextsPanel />
  const center =
    tab === 'biblia' ? <BibleCenter /> : tab === 'mensagens' ? <MessageReader /> : tab === 'midia' ? <MediaCenter /> : <SlidesView />

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <aside className="pane left">{left}</aside>
        <main className="pane center">{center}</main>
        <aside className="pane right">
          <LivePanel />
          <PreviewPanel />
          <PlaylistPanel />
        </aside>
      </div>
      <AudioPlayer />
      <Suspense fallback={null}>
        {modal?.type === 'song' && <SongEditor initial={modal.song} />}
        {modal?.type === 'import' && <ImportDialog target={modal.target} />}
        {modal?.type === 'settings' && <SettingsDialog initialTab={modal.tab} />}
        {modal?.type === 'theme' && <ThemeEditor initial={modal.theme} />}
        {modal?.type === 'search' && <GlobalSearch />}
        {modal?.type === 'text' && <TextEditor id={modal.id} />}
        {firstRun && <Welcome onClose={() => setFirstRun(false)} />}
      </Suspense>
      <Toasts />
    </div>
  )
}
