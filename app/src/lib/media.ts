import type { Item, MediaRef } from '../types'

export function mediaItem(m: MediaRef): Item {
  return {
    kind: 'media',
    key: `media:${m.path}`,
    title: m.name,
    subtitle: m.type === 'image' ? 'Imagem' : m.type === 'video' ? 'Vídeo' : 'Áudio',
    slides: [{ text: '', label: m.name, media: m }],
    ref: { ...m },
  }
}

export function formatTime(s: number) {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}
