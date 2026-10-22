// Exporta a lista de reprodução do AVDP para a lista de reprodução (de mídias) aberta no Holyrics,
// pela API oficial (grátis: só `event_id` exige Holyrics Plan, e não é usado aqui).
// Antes: confere as permissões do token e mostra para qual programação do Holyrics vai.
// Música: procurada pelo título no Holyrics (entra como a música dele); se não achar, vai como texto.
// Versículo/trecho: item de versículo na versão do item (mapeada para a chave do Holyrics).
// Mensagem e texto: texto cortado como no telão do AVDP. Mídia: fica de fora (arquivo só deste PC).
import { api } from '../api'
import { useApp } from '../store'
import type { PlaylistItem } from '../types'
import { chunkText, holyricsId, songSlides, textSlides } from './slides'

/** Até quantos parágrafos de uma mensagem vão num item (o resto da mensagem fica no AVDP). */
const MAX_PARAGRAPHS = 40
const NEEDED = 'SearchLyrics,AddToPlaylist'

export interface ExportReport {
  sent: number
  songsLinked: string[]
  songsAsText: string[]
  /** Títulos com mais de uma música igual no Holyrics (usou a do mesmo artista ou a primeira). */
  songsAmbiguous: string[]
  /** Versículos que foram sem versão (a do Holyrics manda). */
  versesDefaultVersion: string[]
  skipped: string[]
}

export interface HolyricsTarget {
  /** Programação aberta no Holyrics ("Culto de domingo · 2026-10-18 19:00"). */
  destination: string
  versions: { key: string; title: string }[]
}

/** Sem acento, sem pontuação, minúsculas: "Santo, Santo!" = "santo santo". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Confere as permissões do token e lê a programação aberta e as versões da Bíblia do Holyrics. */
export async function prepareHolyricsExport(): Promise<HolyricsTarget> {
  // sem permissão o Holyrics responde erro (e mostra um pedido de liberação na tela dele)
  await api.holyricsCall('CheckPermissions', { actions: NEEDED })
  const sch = (await api.holyricsCall('GetCurrentSchedule', {})) as { data?: { name?: string; datetime?: string; type?: string } | { name?: string; datetime?: string }[] }
  const d = Array.isArray(sch?.data) ? sch.data[0] : sch?.data
  const destination = [d?.name?.trim() || 'programação sem nome', d?.datetime].filter(Boolean).join(' · ')
  const v = (await api.holyricsCall('GetBibleVersionsV2', {})) as { data?: { key: string; title: string }[] }
  return { destination, versions: Array.isArray(v?.data) ? v.data : [] }
}

/** Chave da versão no Holyrics para uma Bíblia do AVDP (pela sigla no fim da chave ou pelo nome). */
function holyricsVersionFor(bibleId: string | undefined, versions: HolyricsTarget['versions']): string | undefined {
  const b = useApp.getState().bibles.find((x) => x.id === bibleId)
  if (!b) return undefined
  const ab = fold(b.abbrev)
  const name = fold(b.name)
  return versions.find((v) => fold(v.key).split(' ').pop() === ab || fold(v.key).endsWith(` ${ab}`) || fold(v.key).replace(/^[a-z]{2} /, '') === ab)?.key ?? versions.find((v) => fold(v.title) === name || fold(v.title).includes(name))?.key
}

/** Monta os itens no formato `AddItem` do Holyrics (sem enviar). */
export async function buildHolyricsItems(listName: string, items: PlaylistItem[], target: HolyricsTarget): Promise<{ addItems: Record<string, unknown>[]; report: ExportReport }> {
  const app = useApp.getState()
  const opt = app.settings.slide
  const report: ExportReport = { sent: 0, songsLinked: [], songsAsText: [], songsAmbiguous: [], versesDefaultVersion: [], skipped: [] }
  const addItems: Record<string, unknown>[] = [{ type: 'title', name: `AVDP — ${listName}` }]
  for (const p of items) {
    let ref: Record<string, unknown>
    try {
      ref = JSON.parse(p.ref)
    } catch {
      report.skipped.push(p.label)
      continue
    }
    if (p.kind === 'song') {
      const song = await api.songGet(ref.id as number)
      // procura no Holyrics pelo título; só campos leves; ignora arquivadas; prefere o mesmo artista
      const found = (await api.holyricsCall('SearchLyrics', { text: song.title, title: true, artist: false, note: false, lyrics: false, fields: 'id,title,artist,archived' })) as {
        data?: { id: string | number; title: string; artist?: string; archived?: boolean }[]
      }
      const same = (found?.data ?? []).filter((x) => !x.archived && fold(x.title) === fold(song.title))
      const pick = same.find((x) => song.artist && fold(x.artist ?? '') === fold(song.artist)) ?? same[0]
      if (pick) {
        addItems.push({ type: 'song', id: String(pick.id) })
        report.songsLinked.push(song.title)
        if (same.length > 1) report.songsAmbiguous.push(song.title)
      } else {
        // vai como texto, na ordem dos slides (o refrão repete como no AVDP)
        const text = songSlides(song, { ...opt, titleSlide: false })
          .map((s) => s.text)
          .join('\n\n')
        addItems.push({ type: 'plain_text', name: song.title, text })
        report.songsAsText.push(song.title)
      }
    } else if (p.kind === 'verse') {
      const verses = (ref.verses as number[] | undefined)?.length ? (ref.verses as number[]) : [ref.verse as number]
      const ids = verses.filter((v) => v != null).map((v) => holyricsId(ref.book as number, ref.chapter as number, v))
      if (!ids.length) {
        report.skipped.push(p.label)
        continue
      }
      // a versão do item manda; senão a escolhida para o Holyrics; senão a padrão dele (avisado no resumo)
      const version = holyricsVersionFor(ref.bible as string | undefined, target.versions) ?? (app.settings.holyricsVersion || undefined)
      if (!version) report.versesDefaultVersion.push(p.label)
      addItems.push({ type: 'verse', ids, ...(version ? { version } : {}) })
    } else if (p.kind === 'message') {
      const group = await api.msgGroup(ref.groupId as number)
      const variantId = (ref.variantId as number | null) ?? group.preferred_variant ?? group.variants.find((v) => v.para_count > 0)?.id
      if (!variantId) {
        report.skipped.push(p.label)
        continue
      }
      const paras = await api.msgParagraphs(variantId)
      const start = ref.seq != null ? Math.max(0, paras.findIndex((x) => x.seq === ref.seq)) : 0
      const chosen = paras.slice(start, start + MAX_PARAGRAPHS)
      const variant = group.variants.find((v) => v.id === variantId)
      const first = chosen[0]
      const name = `${group.code} ${variant?.title || group.title}${first && first.num > 0 ? ` — §${first.num}` : ''}`
      // cortado como no telão do AVDP (mesmo limite de caracteres por slide)
      const text = chosen.flatMap((x) => chunkText(x.text, opt.chunkChars)).join('\n\n')
      addItems.push({ type: 'plain_text', name, text })
    } else if (p.kind === 'text') {
      const doc = await api.textGet(ref.id as number)
      addItems.push({ type: 'plain_text', name: doc.title, text: textSlides(doc, opt).map((s) => s.text).join('\n\n') })
    } else {
      report.skipped.push(p.label)
      continue
    }
    report.sent++
  }
  return { addItems, report }
}

/** Envia a lista ao Holyrics (no fim da lista de reprodução de mídias aberta nele), numa chamada só. */
export async function exportPlaylistToHolyrics(listName: string, items: PlaylistItem[], target: HolyricsTarget): Promise<ExportReport> {
  const { addItems, report } = await buildHolyricsItems(listName, items, target)
  await api.holyricsCall('AddToPlaylist', { items: addItems })
  return report
}
