// Editor de música: título, artista, letra (linha em branco separa slides), ordem dos parágrafos.
import { useMemo, useState } from 'react'
import { api } from '../api'
import { tidy } from '../lib/importers'
import { lyricParagraphs, songItem, songSlides } from '../lib/slides'
import { useApp } from '../store'
import type { Song } from '../types'
import { Modal } from './Modal'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

export function SongEditor({ initial }: { initial: Song }) {
  const { setModal, settings, fail, toast, request, openItem, item } = useApp(useShallow((s) => ({ setModal: s.setModal, settings: s.settings, fail: s.fail, toast: s.toast, request: s.request, openItem: s.openItem, item: s.item })))
  const [song, setSong] = useState<Song>(initial)
  const [saving, setSaving] = useState(false)
  const paras = useMemo(() => lyricParagraphs(song.lyrics), [song.lyrics])
  const slides = useMemo(() => songSlides(song, settings.slide), [song, settings.slide])
  const set = (p: Partial<Song>) => setSong((s) => ({ ...s, ...p }))
  const close = () => setModal(null)

  const save = async () => {
    if (!song.lyrics.trim()) return toast('A letra está vazia.', 'error')
    setSaving(true)
    try {
      const id = await api.songSave({ ...song, lyrics: tidy(song.lyrics) })
      const saved = await api.songGet(id)
      toast('Música salva', 'ok')
      request('songs-changed', id)
      if (!item || item.key === `song:${id}` || song.id === 0) openItem(songItem(saved, settings.slide))
      close()
    } catch (e) {
      fail(e)
    } finally {
      setSaving(false)
    }
  }

  const addToOrder = (n: number) => set({ paragraph_order: [song.paragraph_order, String(n)].filter(Boolean).join(',') })

  return (
    <Modal
      title={song.id ? 'Editar música' : 'Nova música'}
      onClose={close}
      wide
      footer={
        <>
          <span className="hint">Linha em branco separa os slides. Comece um parágrafo com “Refrão” para etiquetá-lo.</span>
          <button onClick={close}>Cancelar</button>
          <button className="primary" onClick={save} disabled={saving}>
            <Icon name="check" /> Salvar
          </button>
        </>
      }
    >
      <div className="editor">
        <div className="editor-form">
          <label>
            Título
            <input value={song.title} onChange={(e) => set({ title: e.target.value })} placeholder="(vazio = primeira linha)" autoFocus />
          </label>
          <label>
            Artista / grupo
            <input value={song.artist} onChange={(e) => set({ artist: e.target.value })} />
          </label>
          <div className="row2">
            <label>
              Autor
              <input value={song.author} onChange={(e) => set({ author: e.target.value })} />
            </label>
            <label>
              Copyright
              <input value={song.copyright} onChange={(e) => set({ copyright: e.target.value })} />
            </label>
          </div>
          <label className="grow">
            Letra
            <textarea value={song.lyrics} onChange={(e) => set({ lyrics: e.target.value })} spellCheck={false} placeholder={'Primeira estrofe\nlinha 2\n\nRefrão\nlinha do refrão…'} />
          </label>
          <label>
            Ordem dos parágrafos <small className="hint">(ex.: 1,2,3,2,3 — vazio = na ordem)</small>
            <input value={song.paragraph_order} onChange={(e) => set({ paragraph_order: e.target.value })} />
          </label>
          <div className="para-chips">
            {paras.map((p, i) => (
              <button key={i} className="chip" onClick={() => addToOrder(i + 1)} title={p.lines.join('\n')}>
                {i + 1}
                {p.label ? ` · ${p.label}` : ''}
              </button>
            ))}
            {song.paragraph_order && (
              <button className="chip" onClick={() => set({ paragraph_order: '' })}>
                limpar ordem
              </button>
            )}
          </div>
          <label>
            Anotação (só para o operador)
            <input value={song.note} onChange={(e) => set({ note: e.target.value })} />
          </label>
        </div>
        <div className="editor-preview">
          <div className="grid-title">{slides.length} slides</div>
          <div className="slide-grid small">
            {slides.map((s, i) => (
              <div key={i} className={`slide-card${s.title ? ' title' : ''}`}>
                <span className="slide-label">{s.label}</span>
                <span className="slide-text">{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
