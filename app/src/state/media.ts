// Áudio tocando no operador e estado do vídeo que roda na janela de projeção.
import { emitTo } from '@tauri-apps/api/event'
import { create } from 'zustand'
import type { MediaRef } from '../types'

export interface VideoStatus {
  path: string
  t: number
  dur: number
  paused: boolean
  ended: boolean
}

interface MediaStore {
  audio: MediaRef | null
  audioState: { t: number; dur: number; paused: boolean }
  volume: number
  loop: boolean
  playAudio: (m: MediaRef) => void
  stopAudio: () => void
  video: VideoStatus | null
  videoVolume: number
  setVideo: (v: VideoStatus | null) => void
  videoCmd: (cmd: 'play' | 'pause' | 'toggle' | 'stop' | 'seek' | 'volume' | 'loop', value?: number | boolean) => void
}

export const useMedia = create<MediaStore>((set, get) => ({
  audio: null,
  audioState: { t: 0, dur: 0, paused: true },
  volume: 0.9,
  loop: false,
  playAudio: (m) => set({ audio: m, audioState: { t: 0, dur: 0, paused: false } }),
  stopAudio: () => set({ audio: null, audioState: { t: 0, dur: 0, paused: true } }),
  video: null,
  videoVolume: 1,
  setVideo: (video) => set({ video }),
  videoCmd: (cmd, value) => {
    if (cmd === 'volume' && typeof value === 'number') set({ videoVolume: value })
    emitTo('projection', 'media-cmd', { cmd, value: value ?? (cmd === 'volume' ? get().videoVolume : null) }).catch(() => {})
  },
}))
