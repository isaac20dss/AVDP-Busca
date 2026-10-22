// Abre itens salvos (lista de reprodução, busca geral) no painel certo e ações sobre o item atual.
import { api } from '../api'
import { markLabel, useBible } from '../state/bible'
import { useMsg } from '../state/msg'
import { useApp } from '../store'
import type { ItemKind, MediaRef } from '../types'
import { slideOptsFor } from './fit'
import { mediaItem } from './media'
import { songItem, textItem } from './slides'

export async function openRef(kind: ItemKind, ref: Record<string, unknown>, projectIt = false) {
  const app = useApp.getState()
  try {
    if (kind === 'song') {
      const it = songItem(await api.songGet(ref.id as number), app.settings.slide)
      app.setTab('letras')
      app.openItem(it)
      if (projectIt) app.project(it, 0)
    } else if (kind === 'text') {
      const it = textItem(await api.textGet(ref.id as number), slideOptsFor('text'))
      app.setTab('textos')
      app.openItem(it)
      if (projectIt) app.project(it, 0)
    } else if (kind === 'verse') {
      app.setTab('biblia')
      // abre na versão em que o item foi guardado (se ainda estiver instalada)
      const bible = ref.bible as string | undefined
      const versions = app.settings.bibleVersions
      if (bible && bible !== versions[0] && app.bibles.some((b) => b.id === bible)) app.saveSettings({ bibleVersions: [bible, ...versions.slice(1).filter((v) => v !== bible)] })
      useBible.getState().go(ref.book as number, ref.chapter as number, (ref.verse as number) ?? null, projectIt, (ref.verses as number[] | undefined) ?? [])
    } else if (kind === 'message') {
      app.setTab('mensagens')
      await useMsg.getState().open(ref.groupId as number, (ref.variantId as number) ?? null, (ref.seq as number) ?? null, [], projectIt)
    } else if (kind === 'media') {
      const it = mediaItem(ref as unknown as MediaRef)
      app.setTab('midia')
      app.openItem(it)
      if (projectIt) app.project(it, 0)
    }
  } catch (e) {
    app.fail(e)
  }
}

/** Item da lista na posição i (Ctrl+PgDn / Ctrl+PgUp). */
export async function openPlaylistItem(i: number) {
  const app = useApp.getState()
  const p = app.playlist[i]
  if (!p) return
  app.setPlaylistIndex(i)
  await openRef(p.kind, JSON.parse(p.ref))
}

/** Põe a prévia no ar (Enter): o slide escolhido; na Bíblia, com versículos escolhidos, o trecho. */
export function projectPreview() {
  const app = useApp.getState()
  if (app.tab === 'biblia' && app.item?.kind === 'verse') {
    const b = useBible.getState()
    // reserva noutra língua (a versão escolhida não tem o livro): pede confirmação, como antes
    if (b.blockedByLanguage()) return useBible.setState({ needConfirm: true })
    if (b.sel.length > 1) return b.projectSelection()
  }
  if (app.item) app.project(app.item, app.cursor)
}

/** Adiciona o que está aberto à lista, com o parágrafo (mensagem) ou versículo (Bíblia). */
export function addCurrentToPlaylist() {
  const app = useApp.getState()
  const item = app.item
  if (!item) return
  if (item.kind === 'message') {
    const m = useMsg.getState()
    const p = m.paras.find((x) => x.seq === m.focusSeq)
    const code = m.group?.code ?? ''
    const label = p ? `${code} ${item.title} — §${p.num}: ${p.text.slice(0, 60)}…` : `${code} ${item.title}`
    app.addToPlaylist(item, label, { ...item.ref, seq: p?.seq ?? null, num: p?.num ?? null })
  } else if (item.kind === 'verse') {
    // versículo selecionado ou o trecho escolhido (Ctrl/Shift+clique), com a versão
    const b = useBible.getState()
    const s = item.slides[app.cursor]
    const r = s?.ref
    if (!r) return
    const bible = b.shown[0]
    const abbrev = app.bibles.find((x) => x.id === bible)?.abbrev ?? ''
    const verses = b.sel.length > 1 ? b.sel : undefined
    const label = `${markLabel({ book: r.book, chapter: r.chapter, verse: verses?.[0] ?? r.verse, verses })}${abbrev ? ` — ${abbrev}` : ''}`
    app.addToPlaylist(item, label, { book: r.book, chapter: r.chapter, verse: verses?.[0] ?? r.verse, verses, bible })
  } else app.addToPlaylist(item)
}

export async function editCurrent() {
  const app = useApp.getState()
  const item = app.item
  if (!item) return
  try {
    if (item.kind === 'song') app.setModal({ type: 'song', song: await api.songGet(item.ref.id as number) })
    else if (item.kind === 'text') app.setModal({ type: 'text', id: item.ref.id as number })
  } catch (e) {
    app.fail(e)
  }
}
