// Fontes de letra de fora do app: as importadas de arquivo (.ttf/.otf/.woff/.woff2, guardadas na pasta
// de dados) são registradas com FontFace em cada janela (principal e projeção); as instaladas no
// computador o WebView já acha pelo nome.
import { api, inTauri } from '../api'
import type { CustomFont } from '../types'

const loaded = new Set<string>()
const tried = new Set<string>()

/** Registra as fontes importadas que esta janela ainda não tem. Devolve a lista. */
export async function loadCustomFonts(): Promise<CustomFont[]> {
  if (!inTauri()) return []
  const { custom } = await api.fontsList(false)
  for (const f of custom) {
    if (loaded.has(f.file)) continue
    try {
      const bytes = await api.fontBytes(f.file)
      const face = new FontFace(f.family, bytes, { weight: String(f.weight), style: f.italic ? 'italic' : 'normal' })
      await face.load()
      document.fonts.add(face)
      loaded.add(f.file)
    } catch {
      // arquivo estragado: fica a fonte reserva
    }
  }
  return custom
}

/** Antes de desenhar com `family`: se for uma fonte importada depois que a janela abriu, carrega. */
export async function ensureFont(family: string) {
  if (!family || tried.has(family)) return
  tried.add(family)
  await loadCustomFonts().catch(() => [])
}
