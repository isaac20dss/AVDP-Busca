// Centro na aba Mensagens: leitor com parágrafos numerados, procurar dentro da mensagem,
// escolha/comparação de traduções e projeção.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { chunkFor, mergeFor } from '../lib/fit'
import { chunkIndexAt, firstHit } from '../lib/hits'
import { keysFor, prettyCombo } from '../lib/hotkeys'
import { addCurrentToPlaylist } from '../lib/open'
import { chunkText, paraChunks } from '../lib/slides'
import { textSimilarity, translationName } from '../lib/translations'
import { dropParas, rawParas, republishMessage, useMsg } from '../state/msg'
import { useApp } from '../store'
import type { Paragraph } from '../types'
import { Highlight } from './Marked'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

const SOURCE_LABEL: Record<string, string> = { local: 'banco local', cbb: 'Busca CBB', tdf: 'Tabernáculo da Fé', hub: 'MessageHub', livro: 'livro', import: 'importada' }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Parágrafos que batem com o texto procurado: palavras (todas), "frase exata" ou §número. */
function findMatches(paras: Paragraph[], q: string): { seqs: number[]; terms: string[]; phrases: string[][]; byNumber: boolean } {
  const t = q.trim()
  if (!t) return { seqs: [], terms: [], phrases: [], byNumber: false }
  const num = t.match(/^§?\s*(\d{1,4})$/)
  if (num) {
    const n = +num[1]
    return { seqs: paras.filter((p) => p.num === n).map((p) => p.seq), terms: [], phrases: [], byNumber: true }
  }
  const phrase = t.match(/^"(.+)"$/)
  if (phrase) {
    const f = fold(phrase[1])
    return { seqs: paras.filter((p) => fold(p.text).includes(f)).map((p) => p.seq), terms: [], phrases: [fold(phrase[1]).split(/\s+/)], byNumber: false }
  }
  const ws = fold(t).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0)
  const seqs = paras
    .filter((p) => {
      const tokens = fold(p.text).split(/[^\p{L}\p{N}]+/u)
      return ws.every((w) => tokens.some((x) => x.startsWith(w)))
    })
    .map((p) => p.seq)
  return { seqs, terms: ws, phrases: [], byNumber: false }
}

/** Pedaço do parágrafo (slide) onde está o ponto clicado: mesma divisão do telão. */
function chunkAt(text: string, parts: string[], el: HTMLElement, x: number, y: number): number {
  if (parts.length < 2) return 0
  const r = document.caretRangeFromPoint?.(x, y)
  if (!r || !el.contains(r.startContainer)) return 0
  const pre = document.createRange()
  pre.setStart(el, 0)
  pre.setEnd(r.startContainer, r.startOffset)
  return chunkIndexAt(text, parts, pre.toString().length)
}

interface RowActions {
  select: (seq: number, slide: number) => void
  projectSlide: (slide: number) => void
  projectFrom: (seq: number) => void
  startEdit: (seq: number, text: string) => void
}

interface RowProps {
  p: Paragraph
  start: number
  parts: string[]
  focus: boolean
  live: boolean
  match: boolean
  terms: string[]
  phrases: string[][]
  prefix: boolean
  /** Texto da tradução comparada (null = sem esse parágrafo; undefined = sem comparação). */
  cmp: string | null | undefined
  act: { current: RowActions }
}

const CompareCell = ({ cmp, num }: { cmp: string | null | undefined; num: number }) =>
  cmp === undefined ? null : <p className="cmp">{cmp ?? <em className="hint">(sem parágrafo {num})</em>}</p>

/** Parágrafo inteiro. Memorizado: mover a prévia ou o ao vivo só redesenha os parágrafos que mudam. */
const ParaView = memo(function ParaView({ p, start, parts, focus, live, match, terms, phrases, prefix, cmp, act }: RowProps) {
  return (
    <div
      data-seq={p.seq}
      className={`para${focus ? ' focus' : ''}${live ? ' live' : ''}${match ? ' match' : ''}`}
      // Ctrl + duplo clique não seleciona a palavra (o duplo clique comum continua podendo copiar texto)
      onMouseDown={(e) => (e.ctrlKey || e.metaKey) && e.detail > 1 && e.preventDefault()}
      onClick={(e) => {
        const el = e.currentTarget.querySelector('p')
        act.current.select(p.seq, start + (el ? chunkAt(p.text, parts, el, e.clientX, e.clientY) : 0))
      }}
      onDoubleClick={(e) => {
        // Ctrl + duplo clique numa palavra: projeta o slide (pedaço do parágrafo) onde ela está
        const el = e.currentTarget.querySelector('p')
        if ((e.ctrlKey || e.metaKey) && el) {
          window.getSelection()?.removeAllRanges()
          act.current.projectSlide(start + chunkAt(p.text, parts, el, e.clientX, e.clientY))
        } else act.current.projectFrom(p.seq)
      }}
      title="Clique: prévia • duplo clique: projetar a partir daqui • Ctrl + duplo clique numa palavra: projetar só o slide dela"
    >
      <span className="pnum">{p.num > 0 ? p.num : ''}</span>
      <p>
        <Highlight text={p.text} terms={terms} phrases={phrases} prefix={prefix} />
      </p>
      <CompareCell cmp={cmp} num={p.num} />
    </div>
  )
})

/** Parágrafo dividido como vai para o telão. `cur`/`air`: slide da prévia/no ar dentro dele (-1 = outro). */
const ParaSlides = memo(function ParaSlides({ p, start, parts, focus, live, match, cur, air, terms, phrases, prefix, cmp, act }: RowProps & { cur: number; air: number }) {
  return (
    <div data-seq={p.seq} className={`para by-slides${focus ? ' focus' : ''}${live ? ' live' : ''}${match ? ' match' : ''}`}>
      <span className="pnum">{p.num > 0 ? p.num : ''}</span>
      <div className="chunks">
        {parts.map((t, k) => {
          const s = start + k
          return (
            <div
              key={k}
              className={`chunk${s === cur ? ' cur' : ''}${s === air ? ' on-air' : ''}`}
              onMouseDown={(e) => e.detail > 1 && e.preventDefault()}
              onClick={() => act.current.select(p.seq, s)}
              onDoubleClick={() => act.current.projectSlide(s)}
              title="Clique: prévia • duplo clique: projetar este slide"
            >
              {parts.length > 1 && (
                <span className="chunk-n">
                  {k + 1}/{parts.length}
                </span>
              )}
              <p>
                <Highlight text={t} terms={terms} phrases={phrases} prefix={prefix} />
              </p>
            </div>
          )
        })}
      </div>
      <CompareCell cmp={cmp} num={p.num} />
    </div>
  )
})

/** Parágrafo no modo de edição (clique abre a caixa de texto). */
const EditTarget = memo(function EditTarget({ p, act }: { p: Paragraph; act: { current: RowActions } }) {
  return (
    <div data-seq={p.seq} className="para edit-target" onClick={() => act.current.startEdit(p.seq, p.text)} title="Clique para corrigir este parágrafo">
      <span className="pnum">{p.num > 0 ? p.num : ''}</span>
      <p>{p.text}</p>
    </div>
  )
})

export function MessageReader() {
  const { item, live, liveIndex, cursor, setCursor, project, settings, saveSettings, toast, fail, focusRequest } = useApp(useShallow((s) => ({ item: s.item, live: s.live, liveIndex: s.liveIndex, cursor: s.cursor, setCursor: s.setCursor, project: s.project, settings: s.settings, saveSettings: s.saveSettings, toast: s.toast, fail: s.fail, focusRequest: s.focusRequest })))
  const { group, variantId, paras, compareId, compareParas, focusSeq, terms, hl, setVariant, setCompare, choose, loading } = useMsg(useShallow((s) => ({ group: s.group, variantId: s.variantId, paras: s.paras, compareId: s.compareId, compareParas: s.compareParas, focusSeq: s.focusSeq, terms: s.terms, hl: s.hl, setVariant: s.setVariant, setCompare: s.setCompare, choose: s.choose, loading: s.loading })))
  // edição do texto (corrigir erro de escrita, palavras grudadas, juntar parágrafo partido)
  const [editing, setEditing] = useState(false)
  const [editSeq, setEditSeq] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const [find, setFind] = useState('')
  const [findIdx, setFindIdx] = useState(0)
  const isLive = !!item && live?.key === item.key && item.kind === 'message'
  const isOpen = item?.kind === 'message'
  const bySlides = settings.msgView === 'slides'
  /** Próxima rolagem até o parágrafo em foco: 'none' (clique), 'nearest' (setas) ou centro (padrão). */
  const nextScroll = useRef<'none' | 'nearest' | null>(null)
  const act = useRef<RowActions>(null!)

  // pedaços de cada parágrafo como vão para o telão (divisão pelo tamanho da letra do tema), e o primeiro slide de cada um
  // depende do tema das mensagens (tamanho da letra, margens, tolerância) e das configurações: refaz quando mudam
  const themes = useApp((s) => s.themes)
  const chunk = useMemo(() => chunkFor('message'), [themes, settings]) // eslint-disable-line react-hooks/exhaustive-deps
  // pedaço curto (menos que a tolerância) vai junto com o vizinho no mesmo slide
  const merge = useMemo(() => mergeFor('message'), [themes, settings, chunk]) // eslint-disable-line react-hooks/exhaustive-deps
  const parts = useMemo(
    () =>
      paras.map((p) => {
        const c = paraChunks(p.text, chunk, merge)
        return c.length ? c : [p.text]
      }),
    [paras, chunk, merge],
  )
  const starts = useMemo(() => {
    const out: number[] = []
    let n = 0
    for (const c of parts) {
      out.push(n)
      n += c.length
    }
    return out
  }, [parts])
  /** Parágrafo (índice) de um slide. */
  const paraOf = (slide: number) => {
    let k = 0
    for (let i = 0; i < starts.length; i++) if (starts[i] <= slide) k = i
    return k
  }

  const liveSeq = useMemo(() => (isLive ? paras[paraOf(liveIndex)]?.seq ?? null : null), [isLive, liveIndex, starts, paras]) // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => findMatches(paras, find), [paras, find])
  const matchSet = useMemo(() => new Set(matches.seqs), [matches])

  // traduções com texto quase igual (mesma tradução vinda de outra fonte)
  const [similar, setSimilar] = useState<Record<number, { other: number; ratio: number }>>({})
  useEffect(() => {
    let alive = true
    setSimilar({})
    const withText = group?.variants.filter((v) => v.para_count > 1 && !v.superseded_by) ?? []
    if (withText.length < 2) return
    ;(async () => {
      const samples: Record<number, string> = {}
      for (const v of withText) samples[v.id] = (await rawParas(v.id)).slice(0, 12).map((p) => p.text).join(' ')
      const out: Record<number, { other: number; ratio: number }> = {}
      for (const a of withText)
        for (const b of withText) {
          if (a.id >= b.id) continue
          const r = textSimilarity(samples[a.id], samples[b.id])
          if (r >= 0.6) {
            if (!out[a.id] || out[a.id].ratio < r) out[a.id] = { other: b.id, ratio: r }
            if (!out[b.id] || out[b.id].ratio < r) out[b.id] = { other: a.id, ratio: r }
          }
        }
      if (alive) setSimilar(out)
    })().catch(() => {})
    return () => {
      alive = false
    }
  }, [group?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // a divisão mudou (tamanho da letra, tolerância) ou o modelo do rodapé: refaz os slides da mensagem aberta
  const layoutKey = `${chunk}|${merge}|${settings.msgFooter}`
  const lastLayout = useRef(layoutKey)
  useEffect(() => {
    const total = parts.reduce((n, c) => n + c.length, 0)
    const changed = lastLayout.current !== layoutKey
    lastLayout.current = layoutKey
    if (isOpen && item && paras.length && (changed || item.slides.length !== total)) republishMessage()
  }, [layoutKey, paras]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- edição ----------
  const reloadAfterEdit = async (focus: number | null) => {
    const g = useMsg.getState().group
    if (!g || variantId == null) return
    dropParas(variantId)
    await useMsg.getState().open(g.id, variantId, focus, terms, false, hl)
    useApp.getState().request('msg-data-changed', null)
  }
  const startEdit = (seq: number, text: string) => {
    setEditSeq(seq)
    setDraft(text)
  }
  const saveEdit = async () => {
    if (editSeq == null || variantId == null) return
    setSaving(true)
    try {
      await api.msgParaSave(variantId, editSeq, draft)
      const seq = editSeq
      setEditSeq(null)
      await reloadAfterEdit(seq)
      toast('Parágrafo corrigido', 'ok')
    } catch (e) {
      fail(e)
    } finally {
      setSaving(false)
    }
  }
  const joinNext = async (seq: number) => {
    if (variantId == null) return
    setSaving(true)
    try {
      // o que está sendo digitado vale antes de juntar
      if (editSeq === seq) await api.msgParaSave(variantId, seq, draft)
      const ok = await api.msgParaJoin(variantId, seq)
      setEditSeq(null)
      await reloadAfterEdit(seq)
      toast(ok ? 'Parágrafo juntado com o seguinte' : 'É o último parágrafo', ok ? 'ok' : 'info')
    } catch (e) {
      fail(e)
    } finally {
      setSaving(false)
    }
  }
  const undoEdits = async () => {
    if (variantId == null || !(await confirm('Desfazer todas as correções desta tradução e voltar ao texto original?'))) return
    try {
      await api.msgEditsUndo(variantId)
      setEditSeq(null)
      await reloadAfterEdit(focusSeq)
      toast('Texto original de volta', 'ok')
    } catch (e) {
      fail(e)
    }
  }

  /** Rola até o parágrafo; no centro, até a palavra procurada dentro dele (não o começo do parágrafo). */
  const scrollTo = (seq: number | null, block: 'center' | 'nearest') => {
    const el = bodyRef.current?.querySelector(seq != null ? `[data-seq="${seq}"]` : '.para')
    if (!el) return
    const mark = block === 'center' && seq != null ? el.querySelector('p:not(.cmp) mark') : null
    ;(mark ?? el).scrollIntoView({ block: seq != null ? block : 'start' })
  }

  // rola até o parágrafo em foco: ao abrir e na busca, a palavra no centro; clique não mexe na tela; setas, só o necessário
  useEffect(() => {
    const mode = nextScroll.current
    nextScroll.current = null
    if (mode === 'none') return
    scrollTo(focusSeq, mode === 'nearest' ? 'nearest' : 'center')
  }, [focusSeq, variantId, group?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // a prévia (cursor) mudou por setas ou pelo ao vivo: o parágrafo dela fica em foco, sem pular a tela
  useEffect(() => {
    if (!isOpen || !paras.length) return
    const seq = paras[paraOf(cursor)]?.seq
    if (seq == null || seq === useMsg.getState().focusSeq) return
    nextScroll.current = 'nearest'
    useMsg.setState({ focusSeq: seq })
  }, [cursor, item?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Clique: o slide vai para a prévia, sem rolar o leitor. */
  const select = (seq: number, slide: number) => {
    if (seq !== focusSeq) {
      nextScroll.current = 'none'
      useMsg.setState({ focusSeq: seq })
    }
    setCursor(slide)
  }

  // Ctrl+Shift+F: procurar nesta mensagem
  useEffect(() => {
    if (focusRequest?.kind === 'search-narrow' && focusRequest.payload === 'mensagens') findRef.current?.select()
  }, [focusRequest])

  // vai para o resultado atual da busca na mensagem: a palavra no centro e a prévia no pedaço dela
  useEffect(() => {
    const seq = matches.seqs[findIdx]
    if (seq == null) return
    const i = paras.findIndex((p) => p.seq === seq)
    if (isOpen && i >= 0) {
      const off = matches.byNumber ? -1 : firstHit(paras[i].text, matches.terms, matches.phrases, true)
      setCursor(starts[i] + (off > 0 ? chunkIndexAt(paras[i].text, parts[i], off) : 0))
    }
    nextScroll.current = 'none'
    useMsg.setState({ focusSeq: seq })
    requestAnimationFrame(() => scrollTo(seq, 'center'))
  }, [findIdx, matches]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setFindIdx(0), [find, variantId])

  // trocar Parágrafos ⇄ Slides: o parágrafo que estava no centro da tela continua no centro
  const keepSeq = useRef<number | null>(null)
  const setView = (msgView: 'paragrafos' | 'slides') => {
    if ((msgView === 'slides') === bySlides) return
    const body = bodyRef.current
    if (body) {
      const r = body.getBoundingClientRect()
      const focused = focusSeq != null ? body.querySelector(`[data-seq="${focusSeq}"]`)?.getBoundingClientRect() : null
      if (focused && focused.bottom > r.top && focused.top < r.bottom) keepSeq.current = focusSeq
      else {
        const mid = r.top + r.height / 2
        const rows = [...body.querySelectorAll<HTMLElement>('[data-seq]')]
        const hit = rows.find((el) => el.getBoundingClientRect().bottom >= mid)
        keepSeq.current = hit ? +hit.dataset.seq! : null
      }
    }
    saveSettings({ msgView })
  }
  useEffect(() => {
    const seq = keepSeq.current
    keepSeq.current = null
    const body = bodyRef.current
    const el = seq != null ? body?.querySelector(`[data-seq="${seq}"]`) : null
    if (!body || !el) return
    // no modo Slides os parágrafos longe da tela têm altura estimada (content-visibility): ao montar, a
    // altura real empurra o alvo; confere por alguns quadros e centraliza de novo se saiu do lugar
    el.scrollIntoView({ block: 'center' })
    let frames = 12
    let raf = 0
    const check = () => {
      const r = body.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      if (Math.abs(b.top + b.bottom - r.top - r.bottom) > 8) el.scrollIntoView({ block: 'center' })
      if (--frames > 0) raf = requestAnimationFrame(check)
    }
    raf = requestAnimationFrame(check)
    return () => cancelAnimationFrame(raf)
  }, [bySlides])

  if (!group)
    return (
      <div className="center-empty">
        <Icon name="message" size={40} />
        <p>Escolha uma mensagem na lista à esquerda (ou pesquise).</p>
        <p className="hint">Clique num parágrafo põe na prévia • duplo clique projeta a partir dele • Ctrl + duplo clique numa palavra projeta só o slide dela • as traduções de uma mesma data ficam juntas e você escolhe qual usar.</p>
      </div>
    )

  // cópia antiga igual à revisão do Tabernáculo da Fé fica escondida (a não ser a que está aberta)
  const variants = group.variants.filter((v) => !v.superseded_by || v.id === variantId)
  const withText = variants.filter((v) => v.para_count > 0)
  const current = group.variants.find((v) => v.id === variantId)
  const compareMap = new Map(compareParas.map((p) => [p.num, p.text]))
  const needsChoice = withText.length > 1 && !group.chosen
  const ownFind = find.trim() && !matches.byNumber
  const shownTerms = ownFind ? matches.terms : terms
  // procurar dentro da mensagem: começo de palavra vale; vindo da pesquisa: segue a opção "Palavra inteira"
  const shownHl = ownFind ? { phrases: matches.phrases, prefix: true } : hl
  const shownPhrases = shownHl.phrases
  const shownPrefix = shownHl.prefix
  const findKeys = keysFor('searchNarrow', settings.hotkeys).map(prettyCombo)[0]

  const projectFrom = (seq: number) => {
    const i = paras.findIndex((p) => p.seq === seq)
    if (item && i >= 0) project(item, starts[i])
  }
  const projectSlide = (slide: number) => {
    if (!item) return
    setCursor(slide)
    project(item, slide)
  }

  const toHolyrics = async () => {
    const seq = focusSeq ?? liveSeq ?? paras[0]?.seq
    const p = paras.find((x) => x.seq === seq)
    if (!p) return
    try {
      await api.holyricsShowSlides(chunkText(p.text, settings.slide.chunkChars).map((t) => `${t}\n\n${group.code} §${p.num}`))
      toast('Parágrafo enviado ao Holyrics', 'ok')
    } catch (e) {
      fail(e)
    }
  }

  // as linhas do leitor são memorizadas: recebem as ações por uma referência estável (sempre a versão atual)
  act.current = { select, projectSlide, projectFrom, startEdit }

  const step = (d: number) => {
    if (!matches.seqs.length) return
    setFindIdx((i) => (i + d + matches.seqs.length) % matches.seqs.length)
  }

  return (
    <div className="reader">
      <div className="center-head">
        <div className="center-title">
          <h1>
            <span className="code">{group.code}</span> {current?.title || group.title}
          </h1>
          <span>{[current?.local || group.local, current ? translationName(current.translation) : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="toolbar">
          <button
            className={editing ? 'on' : ''}
            onClick={() => {
              setEditing(!editing)
              setEditSeq(null)
              if (!editing && bySlides) setView('paragrafos')
            }}
            title="Corrigir o texto: clique num parágrafo para editar (erro de escrita, palavras grudadas) ou juntar com o seguinte"
          >
            <Icon name="edit" /> {editing ? 'Editando' : 'Editar'}
          </button>
          <div className="seg" role="group" aria-label="Como mostrar a mensagem">
            <button className={bySlides ? '' : 'on'} onClick={() => setView('paragrafos')} title="Parágrafo inteiro">
              Parágrafos
            </button>
            <button
              className={bySlides ? 'on' : ''}
              onClick={() => {
                setEditing(false)
                setEditSeq(null)
                setView('slides')
              }}
              title="Cada parágrafo dividido como vai para o telão"
            >
              Slides
            </button>
          </div>
          <button className="primary" onClick={() => (isOpen ? projectSlide(cursor) : projectFrom(focusSeq ?? paras[0]?.seq ?? 0))} disabled={!paras.length} title="Projetar o slide da prévia (Enter)">
            <Icon name="play" /> Projetar
          </button>
          <button onClick={addCurrentToPlaylist} disabled={!item} title="Adicionar à lista (com o parágrafo selecionado)">
            <Icon name="list" /> Lista
          </button>
          <button onClick={toHolyrics} disabled={!paras.length} title="Mostrar o parágrafo no Holyrics (API)">
            <Icon name="send" /> Holyrics
          </button>
        </div>
      </div>

      <div className="translations">
        {variants.map((v) => (
          <button
            key={v.id}
            className={`tr-tab${v.id === variantId ? ' on' : ''}${v.para_count === 0 ? ' notext' : ''}`}
            onClick={() => v.para_count > 0 && setVariant(v.id)}
            disabled={v.para_count === 0}
            title={`${v.title}\n${translationName(v.translation)}\n${SOURCE_LABEL[v.source] ?? v.source} · ${v.para_count} parágrafos`}
          >
            {group.preferred_variant === v.id && group.chosen && <Icon name="check" size={13} />}
            <b>{v.translation || 'sem código'}</b>
            <small>
              {v.para_count ? `${SOURCE_LABEL[v.source] ?? v.source} · ${v.para_count}§` : 'sem texto'}
              {similar[v.id] && (
                <span className="same" title="Texto quase igual: provavelmente a mesma tradução vinda de outra fonte">
                  {' '}
                  ≈ {group.variants.find((x) => x.id === similar[v.id].other)?.translation} {Math.round(similar[v.id].ratio * 100)}%
                </span>
              )}
            </small>
          </button>
        ))}
        <div className="tr-actions">
          {current && current.para_count > 0 && !(group.chosen && group.preferred_variant === current.id) && withText.length > 1 && (
            <button className="primary small" onClick={() => choose(current.id)}>
              Usar esta tradução
            </button>
          )}
          {withText.length > 1 && (
            <select value={compareId ?? ''} onChange={(e) => setCompare(e.target.value ? +e.target.value : null)} title="Mostrar outra tradução ao lado">
              <option value="">Comparar com…</option>
              {withText
                .filter((v) => v.id !== variantId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.translation} ({SOURCE_LABEL[v.source] ?? v.source})
                  </option>
                ))}
            </select>
          )}
        </div>
      </div>
      {(editing || current?.edited) && (
        <div className="banner edit">
          {editing ? 'Modo de edição: clique num parágrafo para corrigir o texto. Ctrl+Enter salva, Esc cancela.' : 'Você corrigiu o texto desta tradução.'}
          {current?.edited && ' A sincronização não troca o seu texto. '}
          {current?.edited && (
            <button className="small" onClick={undoEdits}>
              Desfazer correções
            </button>
          )}
        </div>
      )}
      {needsChoice && (
        <div className="banner choice">
          Esta mensagem tem {withText.length} traduções. Leia, compare e clique em <b>Usar esta tradução</b> na que vai ser usada — as outras continuam guardadas.
        </div>
      )}
      <div className="find-bar">
        <Icon name="search" />
        <input
          ref={findRef}
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              step(e.shiftKey ? -1 : 1)
            }
            if (e.key === 'Escape' && find) {
              e.stopPropagation()
              setFind('')
            }
          }}
          placeholder={`Procurar nesta mensagem: palavras, "frase" ou §número (${findKeys})`}
          aria-label="Procurar nesta mensagem"
        />
        <span className="find-count">
          {find.trim() ? (matches.seqs.length ? `${findIdx + 1}/${matches.seqs.length}` : 'nada') : `${paras.length} §`}
        </span>
        <button className="icon-btn" onClick={() => step(-1)} disabled={!matches.seqs.length} title="Anterior (Shift+Enter)">
          <Icon name="arrowUp" />
        </button>
        <button className="icon-btn" onClick={() => step(1)} disabled={!matches.seqs.length} title="Próximo (Enter)">
          <Icon name="arrowDown" />
        </button>
      </div>

      <div className={`reader-body${compareId ? ' compare' : ''}`} ref={bodyRef}>
        {loading && <div className="hint">Carregando…</div>}
        {!paras.length && !loading && <div className="center-empty">Esta tradução não tem texto. Escolha outra acima ou sincronize o Busca CBB / Tabernáculo da Fé.</div>}
        {paras.map((p, i) => {
          const cmp = compareId ? (compareMap.get(p.num) ?? null) : undefined
          const st = starts[i]
          const n = parts[i].length
          if (bySlides)
            return (
              <ParaSlides
                key={p.id}
                p={p}
                start={st}
                parts={parts[i]}
                focus={p.seq === focusSeq}
                live={p.seq === liveSeq}
                match={matchSet.has(p.seq)}
                cur={isOpen && cursor >= st && cursor < st + n ? cursor : -1}
                air={isLive && liveIndex >= st && liveIndex < st + n ? liveIndex : -1}
                terms={shownTerms}
                phrases={shownPhrases}
                prefix={shownPrefix}
                cmp={cmp}
                act={act}
              />
            )
          if (editing && editSeq === p.seq)
            return (
              <div key={p.id} data-seq={p.seq} className="para editing">
                <span className="pnum">{p.num > 0 ? p.num : ''}</span>
                <div className="para-edit">
                  <textarea
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault()
                        saveEdit()
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        e.stopPropagation()
                        setEditSeq(null)
                      }
                    }}
                    rows={Math.min(14, Math.max(3, Math.ceil(draft.length / 110)))}
                    aria-label={`Texto do parágrafo ${p.num}`}
                  />
                  <div className="row-buttons">
                    <button className="primary small" onClick={saveEdit} disabled={saving || !draft.trim()}>
                      Salvar (Ctrl+Enter)
                    </button>
                    <button className="small" onClick={() => joinNext(p.seq)} disabled={saving || i === paras.length - 1} title="O parágrafo seguinte entra no fim deste (para texto partido no meio)">
                      Juntar com o seguinte
                    </button>
                    <button className="small" onClick={() => setEditSeq(null)} disabled={saving}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )
          if (editing) return <EditTarget key={p.id} p={p} act={act} />
          return (
            <ParaView
              key={p.id}
              p={p}
              start={st}
              parts={parts[i]}
              focus={p.seq === focusSeq}
              live={p.seq === liveSeq}
              match={matchSet.has(p.seq)}
              terms={shownTerms}
              phrases={shownPhrases}
              prefix={shownPrefix}
              cmp={cmp}
              act={act}
            />
          )
        })}
      </div>
    </div>
  )
}
