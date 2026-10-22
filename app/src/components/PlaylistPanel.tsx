// Direita embaixo: lista de reprodução do culto (salva no banco).
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { api, inTauri } from '../api'
import { exportPlaylistToHolyrics, prepareHolyricsExport } from '../lib/holyricsExport'
import { openPlaylistItem, openRef } from '../lib/open'
import { useApp } from '../store'
import type { Playlist } from '../types'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

const KIND_ICON = { song: 'music', verse: 'book', message: 'message', text: 'text', media: 'image' } as const

function todayName() {
  const d = new Date()
  const w = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
  return `${w.toUpperCase()}, ${d.toLocaleDateString('pt-BR')}`
}

// lista do dia criada uma vez só, mesmo com o efeito rodando duas vezes (StrictMode) ou o painel remontando
let todayList: { name: string; id: Promise<number> } | null = null
function ensureTodayList(): Promise<number> {
  const name = todayName()
  if (todayList?.name !== name) {
    const id = api
      .playlistsList()
      .then((ls) => ls.find((l) => l.name === name)?.id ?? api.playlistCreate(name))
      .catch((e) => {
        todayList = null
        throw e
      })
    todayList = { name, id }
  }
  return todayList.id
}

export function PlaylistPanel() {
  const { playlist, playlistId, playlistIndex, setPlaylist, setPlaylistIndex, removeFromPlaylist, movePlaylist, undoPlaylist, redoPlaylist, undo, redo, fail, toast } = useApp(useShallow((s) => ({ playlist: s.playlist, playlistId: s.playlistId, playlistIndex: s.playlistIndex, setPlaylist: s.setPlaylist, setPlaylistIndex: s.setPlaylistIndex, removeFromPlaylist: s.removeFromPlaylist, movePlaylist: s.movePlaylist, undoPlaylist: s.undoPlaylist, redoPlaylist: s.redoPlaylist, undo: s.undo, redo: s.redo, fail: s.fail, toast: s.toast })))
  const [lists, setLists] = useState<Playlist[]>([])
  const [drag, setDrag] = useState<number | null>(null)

  const refresh = async (select?: number) => {
    if (!inTauri()) return
    let ls = await api.playlistsList()
    if (!ls.length) {
      await api.playlistCreate(todayName())
      ls = await api.playlistsList()
    }
    setLists(ls)
    const id = select ?? playlistId ?? ls[0].id
    setPlaylist(id, await api.playlistItems(id))
  }

  useEffect(() => {
    // lista do dia: se ainda não existe uma com a data de hoje, cria e abre (as anteriores continuam no seletor)
    ;(async () => {
      if (!inTauri()) return
      await refresh(await ensureTodayList())
    })().catch(fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const create = async () => {
    const name = prompt('Nome da nova lista:', todayName())
    if (!name) return
    const id = await api.playlistCreate(name)
    await refresh(id)
  }

  // manda a lista inteira para a lista de reprodução aberta no Holyrics (API oficial)
  const [sending, setSending] = useState(false)
  const sendToHolyrics = async () => {
    if (sending) return
    const name = lists.find((l) => l.id === playlistId)?.name ?? 'Lista'
    setSending(true)
    try {
      // confere as permissões e mostra para qual programação do Holyrics vai (sem `event_id`, que é pago)
      const target = await prepareHolyricsExport()
      if (!(await confirm(`Enviar os ${playlist.length} itens de "${name}" para o Holyrics?\n\nVai para a programação aberta nele agora: ${target.destination}`))) return
      const r = await exportPlaylistToHolyrics(name, playlist, target)
      const parts = [`${r.sent} ${r.sent === 1 ? 'item enviado' : 'itens enviados'} para "${target.destination}"`]
      if (r.songsAsText.length) parts.push(`${r.songsAsText.length} música(s) não achada(s) lá foram como texto`)
      if (r.songsAmbiguous.length) parts.push(`${r.songsAmbiguous.length} com título repetido no Holyrics (usei a do mesmo artista ou a primeira)`)
      if (r.versesDefaultVersion.length) parts.push(`${r.versesDefaultVersion.length} versículo(s) na versão padrão do Holyrics`)
      if (r.skipped.length) parts.push(`${r.skipped.length} ficaram de fora (mídia)`)
      toast(parts.join(' · '), 'ok')
    } catch (e) {
      const msg = String(e)
      // tempo esgotado: o Holyrics pode ter gravado mesmo assim; repetir duplicaria a lista
      if (/não respondeu|timed out|tempo/i.test(msg)) toast('O Holyrics demorou a responder. Confira a lista dele antes de enviar de novo (para não duplicar).', 'error')
      else fail(e)
    } finally {
      setSending(false)
    }
  }

  // levar a lista para outro PC: arquivo .avdpfila (Drive, pen drive...). A pasta usada fica lembrada.
  const FILA_FILTER = [{ name: 'Fila do AVDP Busca', extensions: ['avdpfila'] }]
  const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '')
  // testes automáticos (só no modo de desenvolvimento): caminho fixo no lugar da janela de arquivo
  const testPath = () => (import.meta.env.DEV ? (window as unknown as { __avdpFilaPath?: string }).__avdpFilaPath : undefined)
  const exportFila = async () => {
    if (!playlistId) return
    const name = lists.find((l) => l.id === playlistId)?.name ?? 'Lista'
    const dir = (await api.getSettings()).fila_dir
    const file = `${name.replace(/[\\/:*?"<>|]+/g, '-')}.avdpfila`
    const path = testPath() ?? (await saveDialog({ title: 'Exportar a fila para outro computador', defaultPath: dir ? `${dir}\\${file}` : file, filters: FILA_FILTER }))
    if (!path) return
    await api.playlistSetItems(playlistId, playlist)
    const n = await api.filaExport(playlistId, path)
    await api.setSetting('fila_dir', dirOf(path))
    toast(`Fila "${name}" exportada (${n} ${n === 1 ? 'item' : 'itens'}). No outro PC: botão Importar fila.`, 'ok')
  }
  const [importing, setImporting] = useState(false)
  const importFila = async () => {
    if (importing) return
    const dir = (await api.getSettings()).fila_dir
    const path = testPath() ?? (await openDialog({ title: 'Importar fila de outro computador', defaultPath: dir || undefined, multiple: false, filters: FILA_FILTER }))
    if (!path || Array.isArray(path)) return
    setImporting(true)
    try {
      const r = await api.filaImport(String(path))
      await api.setSetting('fila_dir', dirOf(String(path)))
      await refresh(r.playlist_id)
      if (r.messages_downloaded + r.messages_from_file > 0) useApp.getState().request('msg-data-changed', null)
      const parts = [`${r.updated ? 'Fila atualizada' : 'Fila importada'}: "${r.name}", ${r.items} ${r.items === 1 ? 'item' : 'itens'}`]
      if (r.messages_downloaded) parts.push(`${r.messages_downloaded} mensagem(ns) baixada(s) do Tabernáculo da Fé`)
      if (r.messages_from_file) parts.push(`${r.messages_from_file} mensagem(ns) gravada(s) do arquivo`)
      if (r.songs_new || r.songs_updated) parts.push(`músicas: ${r.songs_new} nova(s), ${r.songs_updated} atualizada(s)`)
      if (r.texts_new || r.texts_updated) parts.push(`textos: ${r.texts_new} novo(s), ${r.texts_updated} atualizado(s)`)
      if (r.missing.length) parts.push(`não deu para trazer: ${r.missing.join('; ')}`)
      toast(parts.join(' · '), r.missing.length ? 'error' : 'ok')
    } catch (e) {
      fail(e)
    } finally {
      setImporting(false)
    }
  }

  const remove = async () => {
    if (!playlistId) return
    const cur = lists.find((l) => l.id === playlistId)
    if (!(await confirm(`Excluir a lista "${cur?.name}"?`))) return
    await api.playlistDelete(playlistId)
    useApp.getState().setPlaylist(null, [])
    await refresh()
  }

  return (
    <section className="playlist">
      <div className="playlist-head">
        <Icon name="list" />
        <select value={playlistId ?? ''} onChange={(e) => refresh(+e.target.value).catch(fail)} aria-label="Lista de reprodução">
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button className="icon-btn" onClick={undoPlaylist} disabled={!undo.length} title="Desfazer (Ctrl+Z)">
          <Icon name="prev" size={14} />
        </button>
        <button className="icon-btn" onClick={redoPlaylist} disabled={!redo.length} title="Refazer (Ctrl+Y)">
          <Icon name="next" size={14} />
        </button>
        <button className="icon-btn" onClick={() => create().catch(fail)} title="Nova lista">
          <Icon name="plus" />
        </button>
        <button className="icon-btn" onClick={() => exportFila().catch(fail)} disabled={!playlistId} title="Exportar esta fila para outro computador (arquivo .avdpfila)">
          <Icon name="upload" />
        </button>
        <button className="icon-btn" onClick={importFila} disabled={importing} title="Importar fila de outro computador (.avdpfila) — mensagem que faltar é baixada">
          <Icon name="download" />
        </button>
        <button className="icon-btn" onClick={sendToHolyrics} disabled={!playlist.length || sending} title="Enviar esta lista ao Holyrics (vai para a lista de reprodução aberta nele)">
          <Icon name="send" />
        </button>
        <button className="icon-btn" onClick={() => remove().catch(fail)} title="Excluir lista">
          <Icon name="trash" />
        </button>
      </div>
      <ol className="playlist-items">
        {playlist.map((p, i) => (
          <li
            key={i}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag !== null && drag !== i) movePlaylist(drag, i)
              setDrag(null)
            }}
            className={`${drag === i ? 'dragging' : ''}${i === playlistIndex ? ' current' : ''}`}
            onClick={() => openPlaylistItem(i)}
            onDoubleClick={() => {
              setPlaylistIndex(i)
              openRef(p.kind, JSON.parse(p.ref), true)
            }}
            title="Clique para abrir • duplo clique para projetar • arraste para reordenar"
          >
            <Icon name={KIND_ICON[p.kind]} size={14} />
            <span className="pl-label">
              {p.label.split(' — §')[0]}
              {p.label.includes(' — §') && <small>§{p.label.split(' — §')[1]}</small>}
            </span>
            <button
              className="icon-btn tiny"
              onClick={(e) => {
                e.stopPropagation()
                removeFromPlaylist(i)
              }}
              title="Tirar da lista"
            >
              <Icon name="x" size={12} />
            </button>
          </li>
        ))}
        {!playlist.length && <li className="empty">Lista vazia. Use o botão "Lista" num item para adicioná-lo.</li>}
      </ol>
    </section>
  )
}
