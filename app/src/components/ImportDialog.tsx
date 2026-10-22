// Importar letras/textos de arquivos (PDF, Word, PowerPoint, ODT, HTML, TXT, XML, JSON) ou texto colado.
import { useRef, useState } from 'react'
import { api, errText } from '../api'
import { ACCEPTED, importFile, importPasted, tidy, type ImportedDoc } from '../lib/importers'
import { useApp } from '../store'
import { Modal } from './Modal'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

interface Row extends ImportedDoc {
  include: boolean
}

export function ImportDialog({ target: initialTarget }: { target: 'song' | 'text' }) {
  const { setModal, toast, fail, request } = useApp(useShallow((s) => ({ setModal: s.setModal, toast: s.toast, fail: s.fail, request: s.request })))
  const [target, setTarget] = useState(initialTarget)
  const [rows, setRows] = useState<Row[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [paste, setPaste] = useState('')
  const [stripChords, setStripChords] = useState(true)
  const [dup, setDup] = useState<'skip' | 'replace' | 'keep'>('skip')
  const [preview, setPreview] = useState(0)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const close = () => setModal(null)

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    const errs: string[] = []
    const found: Row[] = []
    for (let i = 0; i < list.length; i++) {
      setBusy(`Lendo ${i + 1}/${list.length}: ${list[i].name}`)
      try {
        const docs = await importFile(list[i])
        docs.forEach((d) => found.push({ ...d, include: true }))
        if (!docs.length) errs.push(`${list[i].name}: nada encontrado`)
      } catch (e) {
        errs.push(`${list[i].name}: ${errText(e)}`)
      }
    }
    setBusy('')
    setRows((r) => [...r, ...found])
    setErrors(errs)
  }

  const addPasted = () => {
    const docs = importPasted(paste)
    setRows((r) => [...r, ...docs.map((d) => ({ ...d, include: true }))])
    setPaste('')
  }

  const doImport = async () => {
    const chosen = rows.filter((r) => r.include && r.text.trim())
    if (!chosen.length) return
    setBusy('Gravando…')
    try {
      if (target === 'song') {
        const r = await api.songsImport(
          chosen.map((d) => ({ title: d.title, artist: d.artist, lyrics: tidy(d.text, { stripChords }), source: d.source })),
          dup,
        )
        toast(`Músicas: ${r.added} novas, ${r.updated} atualizadas, ${r.skipped} ignoradas`, 'ok')
        request('songs-changed', null)
      } else {
        for (const d of chosen) await api.textSave({ id: 0, title: d.title, body: tidy(d.text), source: d.source })
        toast(`${chosen.length} texto(s) importado(s)`, 'ok')
        request('texts-changed', null)
      }
      close()
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  const cur = rows[preview]
  const count = rows.filter((r) => r.include).length

  return (
    <Modal
      title="Importar"
      onClose={close}
      wide
      footer={
        <>
          <span className="hint">{busy || `${count} de ${rows.length} selecionado(s)`}</span>
          <button onClick={close}>Cancelar</button>
          <button className="primary" onClick={doImport} disabled={!count || !!busy}>
            <Icon name="upload" /> Importar {count ? `(${count})` : ''}
          </button>
        </>
      }
    >
      <div className="import">
        <div className="import-left">
          <div className="seg">
            <button className={target === 'song' ? 'on' : ''} onClick={() => setTarget('song')}>
              Como músicas
            </button>
            <button className={target === 'text' ? 'on' : ''} onClick={() => setTarget('text')}>
              Como textos
            </button>
          </div>
          <div
            className={`dropzone${drag ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              addFiles(e.dataTransfer.files)
            }}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={28} />
            <p>
              Arraste arquivos aqui ou <u>clique para escolher</u>
            </p>
            <small>PDF · Word (.docx) · PowerPoint (.pptx) · ODT · HTML · TXT · EasySlides/OpenLyrics (.xml) · JSON</small>
            <input ref={fileRef} type="file" multiple accept={ACCEPTED} hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </div>
          <label className="paste">
            Ou cole o texto (várias letras: separe com uma linha <code>---</code>)
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Título\nArtista\n\nPrimeira estrofe…'} />
          </label>
          <button onClick={addPasted} disabled={!paste.trim()}>
            Adicionar texto colado
          </button>
          {target === 'song' && (
            <div className="import-opts">
              <label>
                <input type="checkbox" checked={stripChords} onChange={(e) => setStripChords(e.target.checked)} /> Remover linhas de cifra
              </label>
              <label>
                Repetidas:
                <select value={dup} onChange={(e) => setDup(e.target.value as typeof dup)}>
                  <option value="skip">ignorar</option>
                  <option value="replace">substituir</option>
                  <option value="keep">manter as duas</option>
                </select>
              </label>
            </div>
          )}
          {errors.length > 0 && (
            <ul className="errors">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="import-list">
          {rows.map((r, i) => (
            <div key={i} className={`import-row${i === preview ? ' sel' : ''}`} onClick={() => setPreview(i)}>
              <input type="checkbox" checked={r.include} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, include: e.target.checked } : x)))} />
              <div className="import-fields">
                <input value={r.title} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} placeholder="Título" />
                {target === 'song' && <input value={r.artist} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, artist: e.target.value } : x)))} placeholder="Artista" />}
                <small>{r.source}</small>
              </div>
            </div>
          ))}
          {!rows.length && <div className="empty">Os itens lidos aparecem aqui para conferir antes de gravar.</div>}
        </div>
        <div className="import-preview">
          {cur ? (
            <textarea value={cur.text} onChange={(e) => setRows(rows.map((x, k) => (k === preview ? { ...x, text: e.target.value } : x)))} spellCheck={false} />
          ) : (
            <div className="empty">Prévia do texto</div>
          )}
        </div>
      </div>
    </Modal>
  )
}
