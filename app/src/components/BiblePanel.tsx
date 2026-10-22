// Esquerda na aba Bíblia: referência rápida, versões, grade de livros/capítulos/versículos e pesquisa.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { markLabel, nextVersion, useBible, type BibleMark } from '../state/bible'
import { useApp } from '../store'
import { defaultOpts, type QueryOpts, type VerseRef, type VerseResults } from '../types'
import { Marked } from './Marked'
import { ModeSwitch, OptionChecks } from './SearchOptions'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

export function BiblePanel() {
  const { books, bibles, settings, saveSettings, setModal, focusRequest, fail } = useApp(useShallow((s) => ({ books: s.books, bibles: s.bibles, settings: s.settings, saveSettings: s.saveSettings, setModal: s.setModal, focusRequest: s.focusRequest, fail: s.fail })))
  const { book, chapter, verse, verses, go, sel, favs, hist, toggleFav, removeHist, clearHist } = useBible(useShallow((s) => ({ book: s.book, chapter: s.chapter, verse: s.verse, verses: s.verses, go: s.go, sel: s.sel, favs: s.favs, hist: s.hist, toggleFav: s.toggleFav, removeHist: s.removeHist, clearHist: s.clearHist })))
  const [view, setView] = useState<'livros' | 'pesquisa' | 'favoritos' | 'historico'>('livros')
  const [sort, setSort] = useState<'relevance' | 'bible'>('relevance')
  const [input, setInput] = useState('')
  const [ref, setRef] = useState<VerseRef | null>(null)
  const [opts, setOpts] = useState<QueryOpts>(defaultOpts({ whole_word: true }))
  const [scope, setScope] = useState<'all' | 'ot' | 'nt' | 'book'>('all')
  const [res, setRes] = useState<VerseResults | null>(null)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // pedido mais recente já tratado (o que existia antes de montar não conta)
  const seenRequest = useRef(useApp.getState().focusRequest?.at ?? 0)
  const versions = settings.bibleVersions
  const bookInfo = books.find((b) => b.id === book)

  // carrega o capítulo quando a versão muda
  useEffect(() => {
    useBible.getState().load()
  }, [versions.join(','), bibles.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    useBible.getState().loadMarks()
  }, [])

  const [hlVersions, setHlVersions] = useState<{ key: string; title: string }[]>([])
  useEffect(() => {
    if (settings.bibleViaHolyrics) api.holyricsVersions().then((v) => setHlVersions(Array.isArray(v) ? (v as { key: string; title: string }[]) : [])).catch(() => {})
  }, [settings.bibleViaHolyrics])

  useEffect(() => {
    // cada pedido vale uma vez: ao remontar o painel (trocar de aba) o último pedido não é aplicado de novo
    if (!focusRequest || focusRequest.at <= seenRequest.current) return
    seenRequest.current = focusRequest.at
    if (focusRequest?.kind === 'focus-search' && focusRequest.payload === 'biblia') inputRef.current?.select()
    if (focusRequest?.kind === 'search-narrow' && focusRequest.payload === 'biblia') {
      // Ctrl+Shift+F: pesquisa no livro atual (como no Holyrics)
      setScope('book')
      setView('pesquisa')
      inputRef.current?.select()
    }
    if (focusRequest?.kind === 'bible-next-version') {
      if (settings.bibleViaHolyrics && hlVersions.length) {
        const i = hlVersions.findIndex((v) => v.key === settings.holyricsVersion)
        const next = hlVersions[(i + 1) % hlVersions.length]
        saveSettings({ holyricsVersion: next.key })
        useApp.getState().toast(`Holyrics: ${next.title}`, 'info')
      } else nextVersion()
    }
  }, [focusRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  // como no Holyrics: com a aba Bíblia aberta, digitar já vai para a caixa de referência
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (useApp.getState().modal || e.ctrlKey || e.altKey || e.metaKey) return
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key.length === 1 && /[\p{L}\d]/u.test(e.key)) {
        e.preventDefault()
        setInput(e.key)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // reconhece a referência enquanto digita
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!input.trim()) return setRef(null)
      setRef(/\d/.test(input) || input.trim().length >= 2 ? await api.bibleParseRef(input).catch(() => null) : null)
    }, 60)
    return () => clearTimeout(t)
  }, [input])

  const search = useCallback(
    async (q: string, o = opts, sc = scope, so = sort, offset = 0) => {
      if (!q.trim() || !versions[0]) return
      setSearching(true)
      try {
        const r = await api.bibleSearch({ query: q, opts: o, bible: versions[0], scope: sc, book, limit: 150, offset, sort: so })
        setRes((prev) => (offset && prev ? { ...r, hits: [...prev.hits, ...r.hits] } : r))
        setView('pesquisa')
        if (!offset) api.historyAdd('biblia', q, JSON.stringify(o), r.total).catch(() => {})
      } catch (e) {
        fail(e)
      } finally {
        setSearching(false)
      }
    },
    [opts, scope, sort, versions, book, fail],
  )

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    // reconhece na hora (o Enter pode chegar antes do reconhecimento enquanto digita)
    const r = input.trim() ? await api.bibleParseRef(input).catch(() => null) : null
    if (r && /\d/.test(input)) {
      // trecho ("1co 13:4-7"): os versículos ficam escolhidos e são projetados juntos ou em sequência
      const range = r.verse != null && r.verse_end != null && r.verse_end > r.verse ? Array.from({ length: r.verse_end - r.verse + 1 }, (_, i) => r.verse! + i) : []
      // vai para a prévia (como na lista); Enter de novo projeta
      go(r.book, r.chapter, r.verse ?? null, false, range)
      setView('livros')
      // setas passam a navegar os versículos, como no Holyrics
      inputRef.current?.blur()
    } else if (r && !/\s/.test(input.trim())) {
      go(r.book, r.chapter, null)
      setView('livros')
    } else search(input)
  }

  const groups = useMemo(() => books, [books])

  if (!bibles.length)
    return (
      <div className="panel">
        <div className="center-empty">
          <Icon name="book" size={36} />
          <p>Nenhuma Bíblia instalada ainda.</p>
          <button className="primary" onClick={() => setModal({ type: 'settings', tab: 'biblias' })}>
            Instalar Bíblias
          </button>
          <p className="hint">Versões livres (download), EasySlides deste PC, ou arquivos XML/JSON/CSV/MyBible.</p>
        </div>
      </div>
    )

  // abre um favorito/histórico na versão em que foi guardado (se ainda estiver instalada)
  function openMark(m: BibleMark, project: boolean) {
    if (m.bible && m.bible !== versions[0] && bibles.some((b) => b.id === m.bible)) saveSettings({ bibleVersions: [m.bible, ...versions.slice(1).filter((v) => v !== m.bible)] })
    go(m.book, m.chapter, m.verse, project, m.verses ?? [])
  }

  const setVersion = (i: number, id: string) => {
    const v = [...versions]
    if (id) v[i] = id
    else v.splice(i, 1)
    saveSettings({ bibleVersions: v.filter(Boolean).slice(0, 3) })
  }

  return (
    <div className="panel bible-panel">
      <form className="panel-head" onSubmit={submit}>
        <div className="search-row">
          <Icon name="search" className="search-ico" />
          <input
            ref={inputRef}
            className="search big"
            placeholder="jo 3 16  •  sl 23  •  1co 13:4-7  •  ou palavras"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setInput(''))}
            aria-label="Referência ou pesquisa na Bíblia"
          />
        </div>
        <div className="ref-hint">
          {ref && /\d/.test(input) ? (
            <span className="ok">
              ↵ {books.find((b) => b.id === ref.book)?.name} {ref.chapter}
              {ref.verse ? `:${ref.verse}` : ''}
              {ref.verse_end ? `-${ref.verse_end}` : ''}
            </span>
          ) : input.trim() ? (
            <span>↵ pesquisar “{input.trim()}”{ref ? ` (ou ${books.find((b) => b.id === ref.book)?.name})` : ''}</span>
          ) : (
            <span>Digite a referência ou palavras e tecle Enter</span>
          )}
        </div>
        <div className="versions">
          {[0, 1, 2].map((i) =>
            i <= versions.length ? (
              <select key={i} value={versions[i] ?? ''} onChange={(e) => setVersion(i, e.target.value)} aria-label={`Versão ${i + 1}`}>
                {i > 0 && <option value="">{i === versions.length ? '+ versão' : '— tirar —'}</option>}
                {bibles.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.abbrev} — {b.name}
                  </option>
                ))}
              </select>
            ) : null,
          )}
        </div>
        <div className={`holyrics-mode${settings.bibleViaHolyrics ? ' on' : ''}`}>
          <label className="chip-check" title="As Bíblias do Holyrics (ACF, NVI, KJA…) são projetadas pelo próprio Holyrics, pela API">
            <input type="checkbox" checked={settings.bibleViaHolyrics} onChange={(e) => saveSettings({ bibleViaHolyrics: e.target.checked })} /> Projetar pelo Holyrics
          </label>
          {settings.bibleViaHolyrics && (
            <select value={settings.holyricsVersion} onChange={(e) => saveSettings({ holyricsVersion: e.target.value })} aria-label="Versão no Holyrics">
              <option value="">versão atual do Holyrics</option>
              {hlVersions.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.title}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="subtabs">
          <button type="button" className={view === 'livros' ? 'on' : ''} onClick={() => setView('livros')}>
            Livros
          </button>
          <button type="button" className={view === 'pesquisa' ? 'on' : ''} onClick={() => setView('pesquisa')}>
            Pesquisa {res ? `(${res.total})` : ''}
          </button>
          <button type="button" className={view === 'favoritos' ? 'on' : ''} onClick={() => setView('favoritos')} title="Versículos guardados (botão ★ no centro)">
            Favoritos {favs.length ? `(${favs.length})` : ''}
          </button>
          <button type="button" className={view === 'historico' ? 'on' : ''} onClick={() => setView('historico')} title="Últimos versículos projetados">
            Histórico
          </button>
        </div>
      </form>

      {view === 'livros' ? (
        <div className="bible-nav">
          <div className="book-grid">
            {groups.map((b) => (
              <button key={b.id} className={`book g-${b.group}${b.id === book ? ' on' : ''}`} onClick={() => go(b.id, 1)} title={b.name}>
                <b>{b.abbrev}</b>
                <small>{b.name}</small>
              </button>
            ))}
          </div>
          {bookInfo && (
            <>
              <div className="grid-title">{bookInfo.name} — capítulos</div>
              <div className="num-grid">
                {Array.from({ length: bookInfo.chapters }, (_, i) => i + 1).map((c) => (
                  <button key={c} className={c === chapter ? 'on' : ''} onClick={() => go(book, c)}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="grid-title">
                {bookInfo.name} {chapter} — versículos
              </div>
              <div className="num-grid verses">
                {verses.map((v) => (
                  <button key={v.verse} className={v.verse === verse || sel.includes(v.verse) ? 'on' : ''} onClick={() => go(book, chapter, v.verse)} onDoubleClick={() => go(book, chapter, v.verse, true)} title="Clique: prévia • duplo clique: projetar">
                    {v.verse}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : view === 'favoritos' || view === 'historico' ? (
        <MarkList
          marks={view === 'favoritos' ? favs : hist}
          empty={view === 'favoritos' ? 'Nenhum favorito. Use o botão ★ no centro para guardar o versículo (ou o trecho) aberto.' : 'Nenhum versículo projetado ainda.'}
          onOpen={(m, project) => openMark(m, project)}
          onRemove={(i) => (view === 'favoritos' ? toggleFav(favs[i]) : removeHist(i))}
          onClear={view === 'historico' && hist.length ? clearHist : undefined}
        />
      ) : (
        <div className="bible-search">
          <div className="opts-box">
            <ModeSwitch
              opts={opts}
              onChange={(o) => {
                setOpts(o)
                if (input.trim()) search(input, o)
              }}
            />
            <OptionChecks
              opts={opts}
              onChange={(o) => {
                setOpts(o)
                if (input.trim()) search(input, o)
              }}
              compact
            />
            <label className="frow sort-row">
              Ordem
              <select
                value={sort}
                onChange={(e) => {
                  const so = e.target.value as 'relevance' | 'bible'
                  setSort(so)
                  if (input.trim()) search(input, opts, scope, so)
                }}
                aria-label="Ordem dos resultados"
              >
                <option value="relevance">Relevância</option>
                <option value="bible">Ordem bíblica (Gn → Ap)</option>
              </select>
            </label>
            <div className="scope">
              {(
                [
                  ['all', 'Toda a Bíblia'],
                  ['ot', 'AT'],
                  ['nt', 'NT'],
                  ['book', bookInfo?.name ?? 'Livro'],
                ] as const
              ).map(([id, label]) => (
                <label key={id}>
                  <input
                    type="radio"
                    checked={scope === id}
                    onChange={() => {
                      setScope(id)
                      if (input.trim()) search(input, opts, id)
                    }}
                  />{' '}
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="list-meta">
            <span>{searching ? 'Pesquisando…' : res ? `${res.total} versículo${res.total === 1 ? '' : 's'} em ${bibles.find((b) => b.id === versions[0])?.abbrev}` : 'Digite palavras acima e tecle Enter'}</span>
          </div>
          <ul className="result-list">
            {res?.hits.map((h) => (
              <li
                key={`${h.book}-${h.chapter}-${h.verse}`}
                onClick={() => go(h.book, h.chapter, h.verse)}
                onDoubleClick={() => go(h.book, h.chapter, h.verse, true)}
                title="Clique para abrir • duplo clique para projetar"
              >
                <div className="r-title">{h.reference}</div>
                <div className="r-snippet">
                  <Marked text={h.marked} />
                </div>
              </li>
            ))}
            {res && res.hits.length < res.total && (
              <li className="more" onClick={() => search(input, opts, scope, sort, res.hits.length)}>
                Mostrar mais ({res.total - res.hits.length} restantes)
              </li>
            )}
            {res && !res.hits.length && <li className="empty">Nada encontrado. Tente “Variações” ou “Aproximada”.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

function MarkList({
  marks,
  empty,
  onOpen,
  onRemove,
  onClear,
}: {
  marks: BibleMark[]
  empty: string
  onOpen: (m: BibleMark, project: boolean) => void
  onRemove: (i: number) => void
  onClear?: () => void
}) {
  const bibles = useApp((s) => s.bibles)
  return (
    <ul className="result-list marks">
      {marks.map((m, i) => (
        <li key={`${m.book}-${m.chapter}-${m.verse}-${m.verses?.join('.') ?? ''}-${i}`} onClick={() => onOpen(m, false)} onDoubleClick={() => onOpen(m, true)} title="Clique para abrir • duplo clique para projetar">
          <div className="r-title">
            {markLabel(m)}
            {m.bible && <span className="badge">{bibles.find((b) => b.id === m.bible)?.abbrev ?? m.bible}</span>}
          </div>
          <button
            className="icon-btn tiny"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(i)
            }}
            title="Tirar"
          >
            <Icon name="x" size={12} />
          </button>
        </li>
      ))}
      {!marks.length && <li className="empty">{empty}</li>}
      {onClear && (
        <li className="clear-history" onClick={onClear}>
          Limpar histórico
        </li>
      )}
    </ul>
  )
}
