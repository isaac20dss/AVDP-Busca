import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { slideOptsFor } from '../lib/fit'
import { textItem, textSlides } from '../lib/slides'
import { useApp } from '../store'
import type { TextDoc } from '../types'
import { Modal } from './Modal'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

export function TextEditor({ id }: { id: number }) {
  const { setModal, settings, fail, toast, request, openItem } = useApp(useShallow((s) => ({ setModal: s.setModal, settings: s.settings, fail: s.fail, toast: s.toast, request: s.request, openItem: s.openItem })))
  const [doc, setDoc] = useState<TextDoc>({ id: 0, title: '', body: '', source: '' })
  useEffect(() => {
    if (id) api.textGet(id).then(setDoc).catch(fail)
  }, [id, fail])
  const slides = useMemo(() => textSlides(doc, slideOptsFor('text')), [doc, settings.slide]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => setModal(null)
  const save = async () => {
    try {
      const nid = await api.textSave(doc)
      toast('Texto salvo', 'ok')
      request('texts-changed', nid)
      openItem(textItem(await api.textGet(nid), slideOptsFor('text')))
      close()
    } catch (e) {
      fail(e)
    }
  }
  return (
    <Modal
      title={id ? 'Editar texto' : 'Novo texto'}
      onClose={close}
      wide
      footer={
        <>
          <span className="hint">Linha em branco separa os slides; blocos longos são divididos automaticamente.</span>
          <button onClick={close}>Cancelar</button>
          <button className="primary" onClick={save}>
            <Icon name="check" /> Salvar
          </button>
        </>
      }
    >
      <div className="editor">
        <div className="editor-form">
          <label>
            Título
            <input value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} autoFocus />
          </label>
          <label className="grow">
            Texto
            <textarea value={doc.body} onChange={(e) => setDoc({ ...doc, body: e.target.value })} />
          </label>
        </div>
        <div className="editor-preview">
          <div className="grid-title">{slides.length} slides</div>
          <div className="slide-grid small">
            {slides.map((s, i) => (
              <div key={i} className="slide-card">
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
