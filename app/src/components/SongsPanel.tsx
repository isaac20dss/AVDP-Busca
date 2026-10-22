// Lista e busca de músicas (busca melhorada em relação ao Holyrics).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { songItem } from '../lib/slides'
import { useApp } from '../store'
import { defaultOpts, emptySong, type QueryOpts, type SongResults } from '../types'
import { Marked } from './Marked'
import { ModeSwitch, OptionChecks, SYNTAX_HELP } from './SearchOptions'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

export function SongsPanel() {
  const { openItem, item, setModal, settings, fail, focusRequest, project, addToPlaylist } = useApp(useShallow((s) => ({ openItem: s.openItem, item: s.item, setModal: s.setModal, settings: s.settings, fail: s.fail, focusRequest: s.focusRequest, project: s.project, addToPlaylist: s.addToPlaylist })))
  const [query, setQuery] = useState('')
  const [opts, setOpts] = useState<QueryOpts>(defaultOpts())
  const [showOpts, setShowOpts] = useState(false)
  const [sort, setSort] = useState('title')
  const [res, setRes] = useState<SongResults>({ hits: [], total: 0, terms: [], approximate: false })
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const seq = useRef(0)

  const run = useCallback(async () => {
    const my = ++seq.current
    try {
      const r = await api.songsSearch(query, opts, sort)
      if (my === seq.current) {
        setRes(r)
        setSel(0)
      }
    } catch (e) {
      fail(e)
    }
  }, [query, opts, sort, fail])

  useEffect(() => {
    const t = setTimeout(run, query ? 110 : 0)
    return () => clearTimeout(t)
  }, [run, query])

  // recarrega quando o editor/importação salvam
  useEffect(() => {
    if (focusRequest?.kind === 'songs-changed') run()
    if (focusRequest?.kind === 'focus-search' && focusRequest.payload === 'letras') inputRef.current?.select()
  }, [focusRequest, run])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const open = async (id: number, projectFirst = false) => {
    try {
      const song = await api.songGet(id)
      const it = songItem(song, settings.slide)
      openItem(it)
      if (projectFirst) project(it, 0)
    } catch (e) {
      fail(e)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, res.hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && res.hits[sel]) {
      e.preventDefault()
      open(res.hits[sel].id, e.ctrlKey)
    } else if (e.key === 'Escape' && query) {
      e.stopPropagation()
      setQuery('')
    }
  }

  const del = async () => {
    const id = item?.kind === 'song' ? (item.ref.id as number) : res.hits[sel]?.id
    if (!id) return
    const title = item?.kind === 'song' ? item.title : res.hits[sel]?.title
    if (!(await confirm(`Excluir a música "${title}"? Isto não pode ser desfeito.`))) return
    await api.songDelete(id).catch(fail)
    run()
  }

  const editCurrent = async () => {
    const id = item?.kind === 'song' ? (item.ref.id as number) : res.hits[sel]?.id
    if (!id) return
    setModal({ type: 'song', song: await api.songGet(id) })
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="search-row">
          <Icon name="search" className="search-ico" />
          <input
            ref={inputRef}
            className="search"
            placeholder="Título, artista ou trecho da letra…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            aria-label="Buscar música"
          />
          {query && (
            <button className="icon-btn clear" onClick={() => setQuery('')} title="Limpar">
              <Icon name="x" size={14} />
            </button>
          )}
          <button className={`icon-btn${showOpts ? ' on' : ''}`} onClick={() => setShowOpts((v) => !v)} title="Opções de busca">
            <Icon name="filter" />
          </button>
        </div>
        {showOpts && (
          <div className="opts-box">
            <ModeSwitch opts={opts} onChange={setOpts} />
            <OptionChecks opts={opts} onChange={setOpts} compact />
            <p className="hint">{SYNTAX_HELP}</p>
          </div>
        )}
        <div className="list-meta">
          <span>
            {query ? `${res.total} resultado${res.total === 1 ? '' : 's'}` : `${res.total} música${res.total === 1 ? '' : 's'}`}
          </span>
          {!query && (
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
              <option value="title">Título</option>
              <option value="artist">Artista</option>
              <option value="most">Mais tocadas</option>
              <option value="recent">Recentes</option>
            </select>
          )}
        </div>
        {res.approximate && <div className="banner">Nada exato. Mostrando músicas com palavras parecidas.</div>}
      </div>
      <ul className="result-list" ref={listRef} role="listbox">
        {res.hits.map((h, i) => (
          <li
            key={h.id}
            role="option"
            aria-selected={i === sel}
            className={`${i === sel ? 'sel' : ''}${item?.key === `song:${h.id}` ? ' open' : ''}`}
            onClick={() => {
              setSel(i)
              open(h.id)
            }}
            onDoubleClick={() => open(h.id, true)}
          >
            <div className="r-title">{h.title}</div>
            {h.artist && <div className="r-sub">{h.artist}</div>}
            {h.marked && (
              <div className="r-snippet">
                <Marked text={h.marked} />
              </div>
            )}
          </li>
        ))}
        {!res.hits.length && (
          <li className="empty">
            {query ? 'Nenhuma música encontrada.' : 'Nenhuma música ainda. Use "Nova" ou "Importar" (TXT, PDF, Word, HTML, PowerPoint…).'}
          </li>
        )}
      </ul>
      <div className="panel-foot">
        <button onClick={() => setModal({ type: 'song', song: emptySong() })}>
          <Icon name="plus" /> Nova
        </button>
        <button onClick={() => setModal({ type: 'import', target: 'song' })}>
          <Icon name="upload" /> Importar
        </button>
        <button onClick={editCurrent} disabled={!res.hits.length} title="Editar (F2)">
          <Icon name="edit" />
        </button>
        <button onClick={() => item?.kind === 'song' && addToPlaylist(item)} disabled={item?.kind !== 'song'} title="Adicionar à lista de reprodução">
          <Icon name="list" />
        </button>
        <button onClick={del} disabled={!res.hits.length} title="Excluir" className="danger">
          <Icon name="trash" />
        </button>
      </div>
    </div>
  )
}
