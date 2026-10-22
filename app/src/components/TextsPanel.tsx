// Textos avulsos (avisos, estudos, poesias, trechos importados de PDF/Word/HTML).
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { slideOptsFor } from '../lib/fit'
import { textItem } from '../lib/slides'
import { useApp } from '../store'
import type { TextDoc } from '../types'
import { Marked } from './Marked'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

export function TextsPanel() {
  const { openItem, item, setModal, fail, focusRequest, addToPlaylist } = useApp(useShallow((s) => ({ openItem: s.openItem, item: s.item, setModal: s.setModal, fail: s.fail, focusRequest: s.focusRequest, addToPlaylist: s.addToPlaylist })))
  const [query, setQuery] = useState('')
  const [docs, setDocs] = useState<TextDoc[]>([])

  const load = useCallback(() => api.textsList(query).then(setDocs).catch(fail), [query, fail])
  useEffect(() => {
    const t = setTimeout(load, 120)
    return () => clearTimeout(t)
  }, [load])
  useEffect(() => {
    if (focusRequest?.kind === 'texts-changed') load()
  }, [focusRequest, load])

  const open = async (id: number) => {
    try {
      openItem(textItem(await api.textGet(id), slideOptsFor('text')))
    } catch (e) {
      fail(e)
    }
  }

  const del = async () => {
    if (item?.kind !== 'text') return
    if (!(await confirm(`Excluir o texto "${item.title}"?`))) return
    await api.textDelete(item.ref.id as number).catch(fail)
    load()
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="search-row">
          <Icon name="search" className="search-ico" />
          <input className="search" placeholder="Buscar nos textos…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar textos" />
        </div>
        <div className="list-meta">
          <span>
            {docs.length} texto{docs.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
      <ul className="result-list">
        {docs.map((d) => (
          <li key={d.id} className={item?.key === `text:${d.id}` ? 'open' : ''} onClick={() => open(d.id)}>
            <div className="r-title">{d.title}</div>
            {d.body ? (
              <div className="r-snippet">
                <Marked text={d.body} />
              </div>
            ) : (
              d.source && <div className="r-sub">{d.source}</div>
            )}
          </li>
        ))}
        {!docs.length && <li className="empty">Nenhum texto. Importe PDF, Word, HTML ou TXT, ou cole um texto.</li>}
      </ul>
      <div className="panel-foot">
        <button onClick={() => setModal({ type: 'text', id: 0 })}>
          <Icon name="plus" /> Novo
        </button>
        <button onClick={() => setModal({ type: 'import', target: 'text' })}>
          <Icon name="upload" /> Importar
        </button>
        <button onClick={() => item?.kind === 'text' && setModal({ type: 'text', id: item.ref.id as number })} disabled={item?.kind !== 'text'} title="Editar">
          <Icon name="edit" />
        </button>
        <button onClick={() => item?.kind === 'text' && addToPlaylist(item)} disabled={item?.kind !== 'text'} title="Adicionar à lista">
          <Icon name="list" />
        </button>
        <button className="danger" onClick={del} disabled={item?.kind !== 'text'} title="Excluir">
          <Icon name="trash" />
        </button>
      </div>
    </div>
  )
}
