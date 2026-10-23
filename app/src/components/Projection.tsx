// Janela de projeção (tela cheia no monitor do público).
import { emit, listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_THEME, imageUrl } from '../lib/theme'
import type { LivePayload } from '../types'
import { SlideRender } from './SlideRender'

interface Layer {
  seq: number
  p: LivePayload
}

export function Projection() {
  const [layers, setLayers] = useState<Layer[]>([])
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const un = listen<LivePayload>('live', (e) => {
      const p = e.payload
      setLayers((ls) => {
        const last = ls[ls.length - 1]
        // mesmo slide (mudou só tela preta, tema, papel de parede): atualiza sem reiniciar vídeo
        if (last && last.seq === p.seq) return [...ls.slice(0, -1), { seq: p.seq, p }]
        return [...ls.slice(-1), { seq: p.seq, p }]
      })
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setLayers((ls) => ls.slice(-1)), Math.max(60, p.fadeMs) + 80)
    })
    emit('projection-ready').catch(() => {})
    return () => {
      un.then((f) => f())
    }
  }, [])

  // modo Holyrics: avisa quando o slide novo já está pintado (fonte e imagem de fundo carregadas), para a
  // foto ir ao Holyrics — sem esperar a imagem, a 1ª vez de um fundo (ex.: papel de parede no F8) saía preta
  const lastP = layers[layers.length - 1]?.p
  useEffect(() => {
    if (!lastP) return
    let alive = true
    const bg = lastP.theme.bg
    const image =
      bg.kind === 'image' && bg.image && lastP.blank !== 'black'
        ? new Promise<void>((done) => {
            const img = new Image()
            img.onload = img.onerror = () => img.decode().catch(() => {}).finally(done)
            img.src = imageUrl(bg.image)
          })
        : Promise.resolve()
    Promise.all([document.fonts.ready, image]).then(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => alive && emit('projection-painted').catch(() => {}))),
    )
    return () => {
      alive = false
    }
  }, [lastP])

  const blank: LivePayload = { seq: -1, slide: null, theme: { ...DEFAULT_THEME, bg: { kind: 'color', color: '#000' } }, blank: 'black', logoText: '', fadeMs: 0 }
  const shown = layers.length ? layers : [{ seq: -1, p: blank }]

  return (
    <div className="projection-root" onDoubleClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
      {shown.map((l, i) => (
        <div
          key={l.seq}
          className="projection-layer"
          style={{ animation: i === shown.length - 1 && shown.length > 1 ? `fadein ${l.p.fadeMs}ms ease both` : undefined }}
        >
          <SlideRender slide={l.p.slide} theme={l.p.theme} blank={l.p.blank} logoText={l.p.logoText} className="full" live={i === shown.length - 1} />
        </div>
      ))}
    </div>
  )
}
