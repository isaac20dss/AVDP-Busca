// Mensagem aberta no leitor: grupo (data), tradução escolhida, parágrafos.
import { create } from 'zustand'
import { api } from '../api'
import { slideOptsFor } from '../lib/fit'
import { chunkIndexAt, firstHit } from '../lib/hits'
import { messageSlides, paraChunks, paraText } from '../lib/slides'
import { useApp } from '../store'
import type { GroupInfo, Item, Paragraph } from '../types'

interface MsgStore {
  group: GroupInfo | null
  variantId: number | null
  paras: Paragraph[]
  /** Tradução mostrada ao lado para comparar. */
  compareId: number | null
  compareParas: Paragraph[]
  focusSeq: number | null
  terms: string[]
  /** Como destacar no leitor: frases inteiras e se vale começo de palavra (segue a busca). */
  hl: { phrases: string[][]; prefix: boolean }
  loading: boolean
  open: (groupId: number, variantId?: number | null, focusSeq?: number | null, terms?: string[], project?: boolean, hl?: { phrases: string[][]; prefix: boolean }) => Promise<void>
  setVariant: (id: number) => Promise<void>
  setCompare: (id: number | null) => Promise<void>
  choose: (variantId: number) => Promise<void>
  /** Índice do primeiro slide de cada parágrafo (seq -> índice). */
  slideIndexOf: (seq: number) => number
}

/** Abertura mais recente: uma mensagem grande que termina de carregar depois não toma o lugar da última clicada. */
let openSeq = 0

export const useMsg = create<MsgStore>((set, get) => ({
  group: null,
  variantId: null,
  paras: [],
  compareId: null,
  compareParas: [],
  focusSeq: null,
  terms: [],
  hl: { phrases: [], prefix: true },
  loading: false,
  open: async (groupId, variantId = null, focusSeq = null, terms = [], project = false, hl = { phrases: [], prefix: true }) => {
    const mine = ++openSeq
    set({ loading: true })
    try {
      const group = await api.msgGroup(groupId)
      const withText = group.variants.filter((v) => v.para_count > 0)
      const vid = variantId ?? group.preferred_variant ?? withText[0]?.id ?? group.variants[0]?.id ?? null
      const paras = vid ? await loadParas(vid, group.variants.find((v) => v.id === vid)?.source) : []
      if (mine !== openSeq) return
      const keepCompare = get().group?.id === groupId ? get().compareId : null
      set({ group, variantId: vid, paras, focusSeq, terms, hl, compareId: keepCompare })
      publish(project)
    } catch (e) {
      useApp.getState().fail(e)
    } finally {
      if (mine === openSeq) set({ loading: false })
    }
  },
  setVariant: async (id) => {
    const paras = await loadParas(id, get().group?.variants.find((v) => v.id === id)?.source)
    // mantém o mesmo número de parágrafo ao trocar de tradução
    const cur = get().paras.find((p) => p.seq === get().focusSeq)
    const focus = cur ? paras.find((p) => p.num === cur.num)?.seq ?? null : null
    set({ variantId: id, paras, focusSeq: focus, compareId: get().compareId === id ? null : get().compareId })
    publish(false)
  },
  setCompare: async (id) => {
    set({ compareId: id, compareParas: id ? await loadParas(id, get().group?.variants.find((v) => v.id === id)?.source) : [] })
  },
  choose: async (variantId) => {
    const g = get().group
    if (!g) return
    await api.msgSetPreferred(g.id, variantId)
    set({ group: { ...g, preferred_variant: variantId, chosen: true } })
    useApp.getState().toast('Tradução escolhida para esta mensagem', 'ok')
  },
  slideIndexOf: (seq) => {
    const opt = slideOptsFor('message')
    let idx = 0
    for (const p of get().paras) {
      if (p.seq === seq) return idx
      idx += Math.max(1, messageSlides([p], { code: '', title: '' }, opt).length)
    }
    return 0
  },
}))

// parágrafos já lidos de cada tradução (as últimas 16): voltar a uma mensagem, trocar de tradução ou
// comparar não pede tudo de novo ao banco. Sai do cache quando o texto muda (correção, sincronização).
const paraCache = new Map<number, Promise<Paragraph[]>>()
export function rawParas(variantId: number): Promise<Paragraph[]> {
  let p = paraCache.get(variantId)
  if (p) {
    paraCache.delete(variantId)
    paraCache.set(variantId, p)
    return p
  }
  p = api.msgParagraphs(variantId)
  p.catch(() => paraCache.delete(variantId))
  paraCache.set(variantId, p)
  while (paraCache.size > 16) paraCache.delete(paraCache.keys().next().value!)
  return p
}
/** Tira do cache (uma tradução, ou todas). */
export function dropParas(variantId?: number) {
  if (variantId == null) paraCache.clear()
  else paraCache.delete(variantId)
}
useApp.subscribe((s, prev) => {
  if (s.focusRequest !== prev.focusRequest && s.focusRequest?.kind === 'msg-data-changed') dropParas()
})

/** Parágrafos da tradução, sem o número repetido no começo do texto (fica só no rodapé). No livro das
 * Eras cada linha é um bloco e os números do texto são do próprio livro (versículos, listas): ficam. */
async function loadParas(variantId: number, source?: string): Promise<Paragraph[]> {
  const ps = await rawParas(variantId)
  if (source === 'livro') return ps
  return ps.map((p) => ({ ...p, text: paraText(p.text, p.num) })).filter((p) => p.text.trim())
}

export function messageItem(): Item | null {
  const { group, variantId, paras } = useMsg.getState()
  if (!group || !variantId) return null
  const v = group.variants.find((x) => x.id === variantId)
  const title = v?.title || group.title
  const footer = useApp.getState().settings.msgFooter
  return {
    kind: 'message',
    key: `message:${group.id}:${variantId}`,
    title,
    subtitle: `${group.code} · ${v?.translation ?? ''}`,
    slides: messageSlides(paras, { code: group.code, title, local: v?.local || group.local, translation: v?.translation, footer }, slideOptsFor('message')),
    ref: { groupId: group.id, variantId },
  }
}

/** Slide da palavra procurada: o pedaço do parágrafo onde ela está (não o começo do parágrafo). */
export function hitSlide(seq: number, terms: string[], hl: { phrases: string[][]; prefix: boolean }): number {
  const st = useMsg.getState()
  const idx = st.slideIndexOf(seq)
  const p = st.paras.find((x) => x.seq === seq)
  if (!p) return idx
  const off = firstHit(p.text, terms, hl.phrases, hl.prefix)
  const o = slideOptsFor('message')
  return off > 0 ? idx + chunkIndexAt(p.text, paraChunks(p.text, o.chunkChars, o.mergeChars), off) : idx
}

function publish(project: boolean) {
  const item = messageItem()
  if (!item) return
  const st = useMsg.getState()
  const idx = st.focusSeq != null ? hitSlide(st.focusSeq, st.terms, st.hl) : 0
  const app = useApp.getState()
  app.openItem(item, idx)
  if (project) app.project(item, idx)
}

/** A divisão mudou (tamanho da letra do tema): refaz os slides da mensagem aberta, no mesmo parágrafo. */
export function republishMessage() {
  const item = messageItem()
  if (!item) return
  const st = useMsg.getState()
  useApp.getState().openItem(item, st.focusSeq != null ? st.slideIndexOf(st.focusSeq) : 0)
}
