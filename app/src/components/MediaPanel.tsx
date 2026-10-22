// Biblioteca de mídia: imagens e vídeos para o telão, áudios para tocar no operador.
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { formatTime, mediaItem } from '../lib/media'
import { imageUrl } from '../lib/theme'
import { useMedia } from '../state/media'
import { useApp } from '../store'
import type { MediaFile, MediaRef } from '../types'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

const KINDS = [
  ['', 'Tudo'],
  ['image', 'Imagens'],
  ['video', 'Vídeos'],
  ['audio', 'Áudios'],
] as const

const asRef = (f: MediaFile): MediaRef => ({ type: f.kind, path: f.path, name: f.name, fit: 'contain', loop: false })

export function MediaPanel() {
  const { openItem, item, project, fail, toast, focusRequest } = useApp(useShallow((s) => ({ openItem: s.openItem, item: s.item, project: s.project, fail: s.fail, toast: s.toast, focusRequest: s.focusRequest })))
  const playAudio = useMedia((s) => s.playAudio)
  const [kind, setKind] = useState<'' | 'image' | 'video' | 'audio'>('')
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<MediaFile[]>([])

  const load = useCallback(() => api.mediaList(kind, query).then(setFiles).catch(fail), [kind, query, fail])
  useEffect(() => {
    const t = setTimeout(load, 100)
    return () => clearTimeout(t)
  }, [load])
  useEffect(() => {
    if (focusRequest?.kind === 'media-changed') load()
  }, [focusRequest, load])

  const add = async (folder: boolean) => {
    const sel = await openDialog(
      folder
        ? { directory: true, multiple: true }
        : {
            multiple: true,
            filters: [{ name: 'Imagens, vídeos e áudios', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'mp4', 'webm', 'mov', 'm4v', 'mkv', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'] }],
          },
    )
    if (!sel) return
    const paths = (Array.isArray(sel) ? sel : [sel]).map(String)
    try {
      const n = await api.mediaAdd(paths)
      toast(`${n} arquivo(s) adicionado(s) à biblioteca`, 'ok')
      load()
    } catch (e) {
      fail(e)
    }
  }

  const open = (f: MediaFile, go: boolean) => {
    const r = asRef(f)
    if (f.kind === 'audio') {
      openItem(mediaItem(r))
      if (go) playAudio(r)
      return
    }
    const it = mediaItem(r)
    openItem(it)
    if (go) project(it, 0)
  }

  let lastFolder = ''
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="search-row">
          <Icon name="search" className="search-ico" />
          <input className="search" placeholder="Nome do arquivo ou pasta…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar mídia" />
        </div>
        <div className="seg" style={{ marginTop: 8 }}>
          {KINDS.map(([k, label]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="list-meta">
          <span>
            {files.length} arquivo{files.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <ul className="result-list media-list">
        {files.map((f) => {
          const head = f.folder !== lastFolder ? f.folder : null
          lastFolder = f.folder
          return (
            <li key={f.id} className={`media-row${item?.key === `media:${f.path}` ? ' open' : ''}${f.exists ? '' : ' missing'}`} onClick={() => open(f, false)} onDoubleClick={() => open(f, true)} title={f.path}>
              {head && <div className="media-folder">{head}</div>}
              <div className="media-line">
                {f.kind === 'image' ? (
                  <img className="media-thumb" src={imageUrl(f.path)} loading="lazy" alt="" />
                ) : (
                  <span className={`media-thumb icon ${f.kind}`}>
                    <Icon name={f.kind === 'video' ? 'video' : 'music'} size={18} />
                  </span>
                )}
                <div className="media-info">
                  <div className="r-title">{f.name}</div>
                  <div className="r-sub">
                    {f.kind === 'image' ? 'Imagem' : f.kind === 'video' ? 'Vídeo' : 'Áudio'} · {(f.size / 1048576).toFixed(1)} MB{f.exists ? '' : ' · arquivo não encontrado'}
                  </div>
                </div>
                <button
                  className="icon-btn tiny"
                  title="Tirar da biblioteca (o arquivo continua no computador)"
                  onClick={(e) => {
                    e.stopPropagation()
                    api.mediaRemove(f.id).then(load).catch(fail)
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            </li>
          )
        })}
        {!files.length && <li className="empty">Adicione imagens, vídeos e músicas do computador. Duplo clique projeta (ou toca o áudio).</li>}
      </ul>
      <div className="panel-foot">
        <button onClick={() => add(false).catch(fail)}>
          <Icon name="plus" /> Arquivos
        </button>
        <button onClick={() => add(true).catch(fail)}>
          <Icon name="folder" /> Pasta
        </button>
      </div>
    </div>
  )
}

export function MediaCenter() {
  const { item, project, live, addToPlaylist } = useApp(useShallow((s) => ({ item: s.item, project: s.project, live: s.live, addToPlaylist: s.addToPlaylist })))
  const { video, videoCmd, videoVolume, playAudio, audio } = useMedia()
  const m = item?.kind === 'media' ? item.slides[0]?.media : undefined
  if (!item || !m)
    return (
      <div className="center-empty">
        <Icon name="image" size={40} />
        <p>Escolha uma imagem, vídeo ou áudio à esquerda.</p>
        <p className="hint">Imagens e vídeos vão para o telão; áudios tocam no computador do operador (fundo musical).</p>
      </div>
    )
  const isLive = live?.key === item.key
  const vs = video && video.path === m.path ? video : null
  return (
    <div className="media-center">
      <div className="center-head">
        <div className="center-title">
          <h1>{m.name}</h1>
          <span>{m.path}</span>
        </div>
        <div className="toolbar">
          {m.type !== 'audio' ? (
            <button className="primary" onClick={() => project(item, 0)}>
              <Icon name="play" /> Projetar
            </button>
          ) : (
            <button className="primary" onClick={() => playAudio(m)}>
              <Icon name="play" /> {audio?.path === m.path ? 'Tocar de novo' : 'Tocar'}
            </button>
          )}
          <button onClick={() => addToPlaylist(item)} title="Adicionar à lista">
            <Icon name="list" /> Lista
          </button>
        </div>
      </div>
      <div className="media-stage">
        {m.type === 'image' && <img src={imageUrl(m.path)} alt={m.name} />}
        {m.type === 'video' && <video src={imageUrl(m.path)} muted controls={false} preload="metadata" />}
        {m.type === 'audio' && (
          <div className="audio-card">
            <Icon name="music" size={48} />
            <p>{m.name}</p>
            <p className="hint">O áudio toca neste computador; os controles ficam na barra embaixo.</p>
          </div>
        )}
      </div>
      {m.type === 'video' && (
        <div className="video-controls">
          <button onClick={() => (isLive ? videoCmd('toggle') : project(item, 0))} title="Tocar/pausar (Ctrl+Espaço)">
            <Icon name={vs && !vs.paused ? 'pause' : 'play'} />
          </button>
          <button onClick={() => videoCmd('stop')} title="Parar (Ctrl+Shift+Espaço)">
            <Icon name="square" />
          </button>
          <input type="range" min={0} max={vs?.dur || 0} step={0.5} value={vs?.t ?? 0} onChange={(e) => videoCmd('seek', +e.target.value)} disabled={!vs} aria-label="Posição do vídeo" />
          <span className="time">
            {formatTime(vs?.t ?? 0)} / {formatTime(vs?.dur ?? 0)}
          </span>
          <Icon name="volume" />
          <input type="range" min={0} max={1} step={0.05} value={videoVolume} onChange={(e) => videoCmd('volume', +e.target.value)} className="vol" aria-label="Volume do vídeo" />
          <label className="chip-check">
            <input type="checkbox" onChange={(e) => videoCmd('loop', e.target.checked)} /> Repetir
          </label>
          {!isLive && <span className="hint">Projete para tocar no telão.</span>}
        </div>
      )}
    </div>
  )
}
