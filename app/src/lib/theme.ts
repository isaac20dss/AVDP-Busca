import { convertFileSrc } from '@tauri-apps/api/core'
import type { CSSProperties } from 'react'
import type { ThemeData, ThemeRow } from '../types'

export const DEFAULT_THEME: ThemeData = {
  bg: { kind: 'color', color: '#000000' },
  font: 'Montserrat',
  size: 7,
  color: '#ffffff',
  bold: true,
  italic: false,
  uppercase: false,
  align: 'center',
  valign: 'middle',
  lineHeight: 1.3,
  shadow: true,
  outline: 0,
  outlineColor: '#000000',
  padding: 6,
  footer: { show: true, size: 3, color: '#d0d0d0' },
}

export const FONTS = ['Montserrat', 'Lato', 'Inter', 'Open Sans', 'Merriweather', 'Roboto Slab', 'Segoe UI', 'Arial', 'Georgia', 'Times New Roman']

export function parseTheme(row?: ThemeRow | null): ThemeData {
  if (!row) return DEFAULT_THEME
  try {
    const d = JSON.parse(row.data)
    return { ...DEFAULT_THEME, ...d, bg: { ...DEFAULT_THEME.bg, ...d.bg }, footer: { ...DEFAULT_THEME.footer, ...d.footer } }
  } catch {
    return DEFAULT_THEME
  }
}

/** Margens do texto (% da altura): superior, inferior e laterais. */
export function margins(t: ThemeData): { top: number; bottom: number; side: number } {
  return { top: t.paddingTop ?? t.padding, bottom: t.paddingBottom ?? t.padding, side: t.paddingSide ?? t.padding * 1.2 }
}

export function imageUrl(path?: string): string {
  if (!path) return ''
  if (/^(https?:|data:|blob:|asset:)/.test(path)) return path
  try {
    return convertFileSrc(path)
  } catch {
    return path
  }
}

export function backgroundStyle(t: ThemeData): CSSProperties {
  const bg = t.bg
  if (bg.kind === 'gradient' && bg.gradient) return { background: bg.gradient }
  if (bg.kind === 'image' && bg.image)
    return {
      backgroundColor: bg.color ?? '#000',
      backgroundImage: `url("${imageUrl(bg.image)}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  return { background: bg.color ?? '#000' }
}

export function textStyle(t: ThemeData): CSSProperties {
  const shadow = t.shadow ? '0 0.06em 0.18em rgba(0,0,0,.85), 0 0 0.5em rgba(0,0,0,.45)' : 'none'
  return {
    fontFamily: `"${t.font}", "Segoe UI", sans-serif`,
    color: t.color,
    fontWeight: t.bold ? 700 : 400,
    fontStyle: t.italic ? 'italic' : 'normal',
    textTransform: t.uppercase ? 'uppercase' : 'none',
    textAlign: t.align,
    lineHeight: t.lineHeight,
    textShadow: shadow,
    WebkitTextStroke: t.outline > 0 ? `${t.outline / 10}cqh ${t.outlineColor}` : undefined,
    paintOrder: 'stroke fill',
  }
}
