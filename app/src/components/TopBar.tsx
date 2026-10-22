import { useEffect, useState } from 'react'
import { api, inTauri } from '../api'
import { useApp, type Tab } from '../store'
import type { MonitorInfo } from '../types'
import { keysFor, prettyCombo, type ActionId } from '../lib/hotkeys'
import { Icon, type IconName } from './icons'
import { useShallow } from 'zustand/react/shallow'

const TABS: { id: Tab; label: string; icon: IconName; key: string }[] = [
  { id: 'letras', label: 'Letras', icon: 'music', key: 'Ctrl+1' },
  { id: 'biblia', label: 'Bíblia', icon: 'book', key: 'Ctrl+2' },
  { id: 'mensagens', label: 'Mensagens', icon: 'message', key: 'Ctrl+3' },
  { id: 'textos', label: 'Textos', icon: 'text', key: 'Ctrl+4' },
  { id: 'midia', label: 'Mídia', icon: 'image', key: 'Ctrl+5' },
]

export function TopBar() {
  const { tab, setTab, setModal, blank, setBlank, endPresentation, live, projectionOpen, setProjectionOpen, settings, saveSettings, fail } = useApp(useShallow((s) => ({ tab: s.tab, setTab: s.setTab, setModal: s.setModal, blank: s.blank, setBlank: s.setBlank, endPresentation: s.endPresentation, live: s.live, projectionOpen: s.projectionOpen, setProjectionOpen: s.setProjectionOpen, settings: s.settings, saveSettings: s.saveSettings, fail: s.fail })))
  const k = (id: ActionId) => keysFor(id, settings.hotkeys).map(prettyCombo)[0] ?? ''
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])

  useEffect(() => {
    if (inTauri()) api.monitorsList().then(setMonitors).catch(() => {})
  }, [])

  const toggleProjection = async () => {
    try {
      if (projectionOpen) {
        await api.projectionClose()
        setProjectionOpen(false)
      } else {
        await api.projectionOpen(settings.monitor)
        setProjectionOpen(true)
      }
    } catch (e) {
      fail(e)
    }
  }

  const chooseMonitor = async (v: string) => {
    const monitor = v === '' ? null : +v
    saveSettings({ monitor })
    if (projectionOpen) await api.projectionOpen(monitor).catch(fail)
  }

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-logo" src="/logo.svg" alt="" /> AVDP Busca
      </div>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} title={`${t.label} (${t.key})`}>
            <Icon name={t.icon} /> {t.label}
          </button>
        ))}
      </nav>
      <button className="global-search" onClick={() => setModal({ type: 'search' })} title="Busca geral (Ctrl+K)">
        <Icon name="search" /> Buscar música, versículo, mensagem… <kbd>Ctrl K</kbd>
      </button>
      <div className="live-controls">
        <button className={`blank-btn${blank === 'logo' ? ' on' : ''}`} onClick={() => setBlank('logo')} title={`Papel de parede: fundo sem texto (${k('wallpaper')})`}>
          <Icon name="image" /> <kbd>{k('wallpaper')}</kbd>
        </button>
        <button className={`blank-btn${blank === 'clear' ? ' on' : ''}`} onClick={() => setBlank('clear')} title={`Slide sem texto, mantém o fundo (${k('blank')})`}>
          <Icon name="eraser" /> <kbd>{k('blank')}</kbd>
        </button>
        <button className={`blank-btn${blank === 'black' ? ' on' : ''}`} onClick={() => setBlank('black')} title={`Tela preta (${k('black')})`}>
          <Icon name="square" /> <kbd>{k('black')}</kbd>
        </button>
        <button className="blank-btn" onClick={endPresentation} disabled={!live && !projectionOpen} title={`Parar de projetar: limpa e fecha a janela de projeção (${k('exit')})`}>
          <Icon name="x" /> <kbd>{k('exit')}</kbd>
        </button>
        <select className="monitor-select" value={settings.monitor ?? ''} onChange={(e) => chooseMonitor(e.target.value)} title="Monitor da projeção">
          <option value="">Em janela</option>
          {monitors.map((m) => (
            <option key={m.index} value={m.index}>
              {m.primary ? '★ ' : ''}
              {m.name.replace(/^\\\\\.\\/, '')} ({m.width}×{m.height})
            </option>
          ))}
        </select>
        <button className={`proj-btn${projectionOpen ? ' on' : ''}`} onClick={toggleProjection} title={`Abrir/fechar a janela de projeção (${k('toggleProjection')})`}>
          <Icon name="monitor" /> {projectionOpen ? 'Projetando' : 'Projetar'}
        </button>
        <button className="icon-btn" onClick={() => setModal({ type: 'settings' })} title="Configurações e fontes de dados">
          <Icon name="gear" size={18} />
        </button>
      </div>
    </header>
  )
}
