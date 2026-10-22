// Desenha um slide com o tema. Usado na projeção e nas prévias (mesmo resultado em qualquer tamanho).
import { emitTo, listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { backgroundStyle, imageUrl, margins, textStyle } from '../lib/theme'
import type { Blank, MediaRef, Slide, ThemeData } from '../types'

interface Props {
  slide: Slide | null
  theme: ThemeData
  blank?: Blank
  logoText?: string
  className?: string
  /** Janela de projeção: o vídeo toca e obedece aos comandos do operador. */
  live?: boolean
}

/** Vídeo na janela de projeção: toca sozinho, recebe comandos e devolve o andamento. */
function LiveVideo({ media }: { media: MediaRef }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    let last = 0
    const report = (force = false) => {
      const now = Date.now()
      if (!force && now - last < 300) return
      last = now
      emitTo('main', 'media-status', { path: media.path, t: v.currentTime, dur: v.duration || 0, paused: v.paused, ended: v.ended }).catch(() => {})
    }
    const onT = () => report()
    const onState = () => report(true)
    v.addEventListener('timeupdate', onT)
    ;['play', 'pause', 'ended', 'loadedmetadata'].forEach((ev) => v.addEventListener(ev, onState))
    const un = listen<{ cmd: string; value: number | boolean | null }>('media-cmd', (e) => {
      const { cmd, value } = e.payload
      if (cmd === 'play') v.play()
      else if (cmd === 'pause') v.pause()
      else if (cmd === 'toggle') (v.paused ? v.play() : v.pause())
      else if (cmd === 'stop') {
        v.pause()
        v.currentTime = 0
      } else if (cmd === 'seek' && typeof value === 'number') v.currentTime = value
      else if (cmd === 'volume' && typeof value === 'number') v.volume = value
      else if (cmd === 'loop') v.loop = !!value
      report(true)
    })
    v.play().catch(() => {})
    return () => {
      v.removeEventListener('timeupdate', onT)
      ;['play', 'pause', 'ended', 'loadedmetadata'].forEach((ev) => v.removeEventListener(ev, onState))
      un.then((f) => f())
      emitTo('main', 'media-status', null).catch(() => {})
    }
  }, [media.path])
  return <video ref={ref} className="stage-media" src={imageUrl(media.path)} loop={media.loop} style={{ objectFit: media.fit ?? 'contain' }} />
}

function MediaLayer({ media, live }: { media: MediaRef; live?: boolean }) {
  if (media.type === 'image') return <img className="stage-media" src={imageUrl(media.path)} alt="" style={{ objectFit: media.fit ?? 'contain' }} />
  if (media.type === 'video') {
    if (live) return <LiveVideo media={media} />
    return <video className="stage-media" src={imageUrl(media.path)} muted preload="metadata" style={{ objectFit: media.fit ?? 'contain' }} />
  }
  return null
}

export function SlideRender({ slide, theme, blank = 'none', logoText = '', className = '', live = false }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(1)
  /** A fonte do tema ainda está carregando: o texto fica escondido para não aparecer cortado. */
  const [fontPending, setFontPending] = useState(false)
  const showText = blank === 'none' && slide && slide.text.trim()
  const hasText = !!showText
  const m = margins(theme)
  const key = `${slide?.text ?? ''}|${slide?.alt ?? ''}|${slide?.peek ?? ''}|${theme.size}|${theme.font}|${m.top}|${m.bottom}|${m.side}|${theme.lineHeight}`

  // reduz a letra até caber
  const measure = useCallback(() => {
    let f = 1
    const box = boxRef.current
    const txt = textRef.current
    if (!box || !txt) return
    txt.style.setProperty('--fit', '1')
    for (let i = 0; i < 24; i++) {
      if (txt.scrollHeight <= box.clientHeight + 1 && txt.scrollWidth <= box.clientWidth + 1) break
      f *= 0.92
      txt.style.setProperty('--fit', String(f))
    }
    setFit(f)
  }, [])

  // Mede na hora e de novo quando a fonte do tema termina de carregar. Numa janela de telão recém-aberta
  // a fonte (ex.: Merriweather) chega depois da primeira medida, a letra fica maior e o texto saía cortado.
  useLayoutEffect(() => {
    measure()
    if (!hasText) return
    const faces = [`400 1em "${theme.font}"`, `700 1em "${theme.font}"`]
    if (faces.every((f) => document.fonts.check(f))) {
      setFontPending(false)
      return
    }
    let alive = true
    setFontPending(true)
    Promise.all(faces.map((f) => document.fonts.load(f)))
      .catch(() => {})
      .finally(() => {
        if (!alive) return
        measure()
        setFontPending(false)
      })
    return () => {
      alive = false
    }
  }, [key, hasText, theme.font, measure])

  // A caixa mudou de tamanho (janela indo para o monitor do telão, tela cheia, prévia redimensionada): mede de novo.
  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    let w = box.clientWidth
    let h = box.clientHeight
    const ro = new ResizeObserver(() => {
      if (box.clientWidth === w && box.clientHeight === h) return
      w = box.clientWidth
      h = box.clientHeight
      measure()
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [measure])

  const footer = theme.footer.show && blank === 'none' && slide?.footer
  const bg = blank === 'black' || (slide?.media && blank === 'none') ? { background: '#000' } : backgroundStyle(theme)
  const dim = theme.bg.kind === 'image' && theme.bg.dim ? theme.bg.dim : 0

  return (
    <div className={`stage ${className}`} style={bg}>
      {dim > 0 && blank !== 'black' && <div className="stage-dim" style={{ opacity: dim }} />}
      {slide?.media && blank === 'none' && <MediaLayer media={slide.media} live={live} />}
      {blank === 'logo' && <div className="stage-logo" style={textStyle(theme)}>{logoText}</div>}
      <div
        className={`stage-box v-${theme.valign}${theme.band ? ' band' : ''}`}
        ref={boxRef}
        style={{ padding: `${m.top}cqh ${m.side}cqh ${m.bottom}cqh`, bottom: footer ? `${theme.footer.size * 1.6}cqh` : 0 }}
      >
        {showText && (
          <div
            ref={textRef}
            className={`stage-text${slide.title ? ' is-title' : ''}`}
            style={{ ...textStyle(theme), fontSize: `calc(${theme.size}cqh * var(--fit, ${fit}))`, visibility: fontPending ? 'hidden' : undefined }}
          >
            {slide.text.split('\n').map((l, i) => (
              <div key={i} className={slide.title && i > 0 ? 'stage-sub' : undefined}>
                {l || ' '}
              </div>
            ))}
            {slide.alt && (
              <div className="stage-alt">
                {slide.alt.split('\n').map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}
            {slide.peek && <div className="stage-peek">{slide.peek}</div>}
          </div>
        )}
      </div>
      {footer && (
        <div className="stage-footer" style={{ fontSize: `${theme.footer.size}cqh`, color: theme.footer.color, fontFamily: `"${theme.font}", sans-serif` }}>
          {slide!.footer}
        </div>
      )}
    </div>
  )
}
