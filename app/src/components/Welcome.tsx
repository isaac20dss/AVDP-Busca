// Primeira abertura: prepara Bíblia e mensagens em poucos cliques.
import { useEffect, useState } from 'react'
import { api } from '../api'
import { EBIBLE_VERSIONS } from '../lib/bibleImport'
import { useBible } from '../state/bible'
import { useApp } from '../store'
import { Modal } from './Modal'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

type Step = { id: string; label: string; detail: string; state: 'todo' | 'run' | 'ok' | 'skip' | 'error'; msg?: string }

export function Welcome({ onClose }: { onClose: () => void }) {
  const { loadBibles, request } = useApp(useShallow((s) => ({ loadBibles: s.loadBibles, request: s.request })))
  const [msgPath, setMsgPath] = useState<string | null>(null)
  const [easy, setEasy] = useState<{ path: string; abbrev: string; name: string; license: string; language: string }[]>([])
  const [steps, setSteps] = useState<Step[]>([])
  const [running, setRunning] = useState(false)
  const [opt, setOpt] = useState({ local: true, cbb: true, tdf: true, bpm: true, easy: true })

  useEffect(() => {
    api.msgDefaultLocalPath().then(setMsgPath).catch(() => {})
    api.bibleScanEasySlides().then(setEasy).catch(() => {})
  }, [])

  const upd = (id: string, p: Partial<Step>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const start = async () => {
    const plan: Step[] = []
    if (opt.local && msgPath) plan.push({ id: 'local', label: 'Mensagens do banco local', detail: msgPath, state: 'todo' })
    if (opt.cbb) plan.push({ id: 'cbb', label: 'Mensagens do Busca CBB', detail: 'download da API pública do site', state: 'todo' })
    if (opt.tdf) plan.push({ id: 'tdf', label: 'Mensagens do Tabernáculo da Fé', detail: 'download da API pública do Busca', state: 'todo' })
    if (opt.bpm) plan.push({ id: 'bpm', label: 'Bíblia Portuguesa Mundial', detail: 'domínio público, eBible.org', state: 'todo' })
    if (opt.easy) easy.filter((e) => /english/i.test(e.language) && /public domain/i.test(e.license)).forEach((e) => plan.push({ id: `easy:${e.path}`, label: `${e.abbrev} (EasySlides)`, detail: e.name, state: 'todo' }))
    setSteps(plan)
    setRunning(true)
    for (const s of plan) {
      upd(s.id, { state: 'run' })
      try {
        if (s.id === 'local') {
          const r = await api.msgImportLocal(msgPath!)
          upd(s.id, { state: 'ok', msg: `${r.with_text} com texto` })
        } else if (s.id === 'cbb') {
          const n = await api.msgSyncCbb()
          upd(s.id, { state: 'ok', msg: `${n} mensagens` })
        } else if (s.id === 'tdf') {
          const r = await api.msgSyncTdf()
          upd(s.id, { state: 'ok', msg: `${r.downloaded} mensagens` })
        } else if (s.id === 'bpm') {
          const v = EBIBLE_VERSIONS[0]
          const n = await api.bibleDownloadEbible({ id: v.id, name: v.name, abbrev: v.abbrev, license: v.license, language: 'pt', source: 'eBible.org' })
          upd(s.id, { state: 'ok', msg: `${n.toLocaleString('pt-BR')} versículos` })
        } else if (s.id.startsWith('easy:')) {
          const e = easy.find((x) => `easy:${x.path}` === s.id)!
          const n = await api.bibleImportMyBible(e.path, { id: e.abbrev.toLowerCase(), name: e.name, abbrev: e.abbrev, license: e.license, language: 'en', source: 'EasySlides' })
          upd(s.id, { state: 'ok', msg: `${n.toLocaleString('pt-BR')} versículos` })
        }
      } catch (e) {
        upd(s.id, { state: 'error', msg: String(e) })
      }
    }
    await loadBibles()
    useBible.getState().load()
    request('msg-data-changed', null)
    await api.setSetting('welcome_done', '1')
    setRunning(false)
  }

  const done = steps.length > 0 && !running
  const finish = async () => {
    await api.setSetting('welcome_done', '1').catch(() => {})
    onClose()
  }

  return (
    <Modal
      title="Bem-vindo ao AVDP Busca"
      onClose={finish}
      footer={
        <>
          <button onClick={finish} disabled={running}>
            {done ? 'Fechar' : 'Pular'}
          </button>
          {!done && (
            <button className="primary" onClick={start} disabled={running}>
              {running ? 'Preparando…' : 'Preparar agora'}
            </button>
          )}
        </>
      }
    >
      <div className="welcome">
        <p>Passador de letras no estilo do Holyrics, com Bíblia e Mensagens. Escolha o que preparar agora (dá para fazer depois em Configurações):</p>
        {!steps.length ? (
          <div className="checks column">
            <label>
              <input type="checkbox" checked={opt.local && !!msgPath} disabled={!msgPath} onChange={(e) => setOpt({ ...opt, local: e.target.checked })} /> Importar mensagens do
              banco local {msgPath ? '' : '(não encontrado)'}
            </label>
            <label>
              <input type="checkbox" checked={opt.cbb} onChange={(e) => setOpt({ ...opt, cbb: e.target.checked })} /> Baixar mensagens do Busca CBB (internet, ~1 min)
            </label>
            <label>
              <input type="checkbox" checked={opt.tdf} onChange={(e) => setOpt({ ...opt, tdf: e.target.checked })} /> Baixar mensagens do Tabernáculo da Fé (internet,
              ~5 min)
            </label>
            <label>
              <input type="checkbox" checked={opt.bpm} onChange={(e) => setOpt({ ...opt, bpm: e.target.checked })} /> Baixar a Bíblia Portuguesa Mundial (livre)
            </label>
            <label>
              <input type="checkbox" checked={opt.easy} disabled={!easy.length} onChange={(e) => setOpt({ ...opt, easy: e.target.checked })} /> Importar KJV/ASV do EasySlides deste
              PC {easy.length ? '' : '(não encontrado)'}
            </label>
          </div>
        ) : (
          <ul className="steps">
            {steps.map((s) => (
              <li key={s.id} className={s.state}>
                <span className="st">{s.state === 'ok' ? <Icon name="check" /> : s.state === 'run' ? '…' : s.state === 'error' ? '!' : '·'}</span>
                <div>
                  <b>{s.label}</b>
                  <small>{s.msg ?? s.detail}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
