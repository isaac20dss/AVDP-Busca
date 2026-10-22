// Tela de palco/retorno (para quem está na frente): o slide no ar, o próximo, a anotação e o relógio.
import { emit, listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import { DEFAULT_THEME } from '../lib/theme'
import type { StagePayload, ThemeData } from '../types'
import { SlideRender } from './SlideRender'

const THEME: ThemeData = {
  ...DEFAULT_THEME,
  font: 'Inter',
  size: 11,
  shadow: false,
  padding: 3,
  bg: { kind: 'color', color: '#000000' },
  footer: { ...DEFAULT_THEME.footer, show: true, size: 4, color: '#9a9ca4' },
}

const BLANK_LABEL = { black: 'TELA PRETA', logo: 'PAPEL DE PAREDE', clear: 'SEM TEXTO', none: '' } as const

export function Stage() {
  const [p, setP] = useState<StagePayload | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const un = listen<StagePayload>('stage', (e) => setP(e.payload))
    emit('stage-ready').catch(() => {})
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => {
      un.then((f) => f())
      window.clearInterval(t)
    }
  }, [])

  const clock = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const next = p?.next
  return (
    <div className="stage-root">
      <header className="stage-top">
        <span className="st-title">{p?.title || 'Nada no ar'}</span>
        <span className="st-label">
          {p?.label} {p?.position && <small>({p.position})</small>}
        </span>
        {p && p.blank !== 'none' && <span className="st-blank">{BLANK_LABEL[p.blank]}</span>}
        <span className="st-clock">{clock}</span>
      </header>
      <div className="stage-current">
        <SlideRender slide={p?.slide ?? null} theme={THEME} className="fill" />
      </div>
      <div className="stage-next">
        <b>A SEGUIR</b>
        <span>{next ? next.text.split('\n').join(' / ') : p?.slide ? 'Fim do item' : ''}</span>
      </div>
      {p?.note && <div className="stage-note">{p.note}</div>}
    </div>
  )
}
