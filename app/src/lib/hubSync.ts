// Sincronização do MessageHub (Português-B): o site só tem PDF. A lista e o PDF vêm pelo Rust; o texto
// sai do PDF aqui (pdf.js, como na importação de arquivos) e volta para o Rust virar parágrafos.
// Roda fora da tela de Configurações: fechar a janela não interrompe.
import { create } from 'zustand'
import { api, errText } from '../api'
import { useApp } from '../store'
import { pdfToText } from './importers'

interface HubSync {
  running: boolean
  /** Fase atual ("Lendo a lista…", "Baixando…", "Arrumando…"). */
  phase: string
  done: number
  total: number
  saved: number
  failed: string[]
  /** Mensagens no site (da última lista). */
  listed: number
  stop: boolean
}

export const useHubSync = create<HubSync>(() => ({ running: false, phase: '', done: 0, total: 0, saved: 0, failed: [], listed: 0, stop: false }))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Baixa as mensagens novas ou revisadas. Devolve um resumo para mostrar ao operador. */
export async function syncHub(): Promise<string> {
  const st = useHubSync
  if (st.getState().running) return 'A sincronização do MessageHub já está rodando.'
  st.setState({ running: true, phase: 'Lendo a lista do site…', done: 0, total: 0, saved: 0, failed: [], stop: false })
  try {
    const list = await api.hubList()
    const todo = list.filter((x) => x.need)
    st.setState({ listed: list.length, total: todo.length, phase: todo.length ? 'Baixando os PDFs…' : 'Nada novo' })
    let streak = 0
    for (const it of todo) {
      if (st.getState().stop) break
      const item = { tm_id: it.tm_id, code: it.code, title: it.title, title_en: it.title_en, local: it.local, updated: it.updated }
      try {
        const buf = await api.hubPdf(item.tm_id)
        const text = await pdfToText(buf)
        const n = await api.hubSave(item, text)
        if (n > 0) st.setState((s) => ({ saved: s.saved + 1 }))
        else st.setState((s) => ({ failed: [...s.failed, `${item.code} ${item.title}: PDF sem texto`] }))
        streak = 0
      } catch (e) {
        st.setState((s) => ({ failed: [...s.failed, `${item.code} ${item.title}: ${errText(e)}`] }))
        // sem internet ou site fora: para depois de 5 falhas seguidas (o que já veio fica gravado)
        if (++streak >= 5) break
      }
      st.setState((s) => ({ done: s.done + 1 }))
      await sleep(300)
    }
    st.setState({ phase: 'Arrumando as traduções…' })
    const hidden = await api.hubFinish()
    useApp.getState().request('msg-data-changed', null)
    const { saved, failed, done, total } = st.getState()
    const parts = [`MessageHub: ${saved} de ${list.length} mensagens baixadas agora`]
    if (done < total) parts.push(`parou em ${done}/${total}`)
    if (failed.length) parts.push(`${failed.length} com problema`)
    parts.push(`${hidden.toLocaleString('pt-BR')} cópias antigas escondidas`)
    return parts.join(' · ')
  } finally {
    st.setState({ running: false, phase: '' })
  }
}
