// Áudio de fundo tocando no computador do operador (não vai para a projeção).
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { inTauri } from '../api'
import { formatTime } from '../lib/media'
import { imageUrl } from '../lib/theme'
import { useMedia, type VideoStatus } from '../state/media'
import { useApp } from '../store'
import { Icon } from './icons'

export function AudioPlayer() {
  const { audio, audioState, volume, loop, stopAudio } = useMedia()
  const ref = useRef<HTMLAudioElement>(null)
  const focusRequest = useApp((s) => s.focusRequest)

  // status do vídeo vindo da janela de projeção
  useEffect(() => {
    if (!inTauri()) return
    const un = listen<VideoStatus | null>('media-status', (e) => useMedia.getState().setVideo(e.payload))
    return () => {
      un.then((f) => f())
    }
  }, [])

  useEffect(() => {
    const a = ref.current
    if (!a) return
    a.volume = volume
    a.loop = loop
  }, [volume, loop, audio])

  // Ctrl+Espaço / Ctrl+Shift+Espaço
  useEffect(() => {
    if (focusRequest?.kind !== 'media-cmd') return
    const s = useApp.getState()
    const videoLive = s.live?.slides[0]?.media?.type === 'video'
    if (videoLive) {
      useMedia.getState().videoCmd(focusRequest.payload === 'stop' ? 'stop' : 'toggle')
      return
    }
    const a = ref.current
    if (!a || !audio) return
    if (focusRequest.payload === 'stop') stopAudio()
    else if (a.paused) a.play()
    else a.pause()
  }, [focusRequest, audio, stopAudio])

  if (!audio) return null
  return (
    <div className="audio-bar">
      <audio
        ref={ref}
        src={imageUrl(audio.path)}
        autoPlay
        onTimeUpdate={(e) => useMedia.setState({ audioState: { t: e.currentTarget.currentTime, dur: e.currentTarget.duration, paused: e.currentTarget.paused } })}
        onPause={(e) => useMedia.setState({ audioState: { ...useMedia.getState().audioState, paused: e.currentTarget.paused } })}
        onPlay={() => useMedia.setState({ audioState: { ...useMedia.getState().audioState, paused: false } })}
        onEnded={() => !loop && stopAudio()}
        onError={() => {
          useApp.getState().toast(`Não foi possível tocar ${audio.name}`, 'error')
          stopAudio()
        }}
      />
      <Icon name="music" />
      <b title={audio.path}>{audio.name}</b>
      <button className="icon-btn" onClick={() => (ref.current?.paused ? ref.current.play() : ref.current?.pause())} title="Tocar/pausar (Ctrl+Espaço)">
        <Icon name={audioState.paused ? 'play' : 'pause'} />
      </button>
      <input
        type="range"
        min={0}
        max={audioState.dur || 0}
        step={0.5}
        value={audioState.t}
        onChange={(e) => ref.current && (ref.current.currentTime = +e.target.value)}
        aria-label="Posição"
      />
      <span className="time">
        {formatTime(audioState.t)} / {formatTime(audioState.dur)}
      </span>
      <label className="chip-check" title="Repetir">
        <input type="checkbox" checked={loop} onChange={(e) => useMedia.setState({ loop: e.target.checked })} /> Repetir
      </label>
      <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => useMedia.setState({ volume: +e.target.value })} aria-label="Volume" className="vol" />
      <button className="icon-btn" onClick={stopAudio} title="Parar (Ctrl+Shift+Espaço)">
        <Icon name="square" />
      </button>
    </div>
  )
}
