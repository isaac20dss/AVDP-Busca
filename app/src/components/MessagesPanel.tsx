// Esquerda na aba Mensagens: pesquisa no estilo The Table e navegação por data/título.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useMsg } from '../state/msg'
import { useApp } from '../store'
import { defaultOpts, type GroupRow, type HistoryItem, type MsgResults, type MsgSearch, type MsgStats, type QueryOpts, type Suggestions } from '../types'
import { Marked } from './Marked'
import { ModeSwitch, OptionChecks, SYNTAX_HELP } from './SearchOptions'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

const SOURCE_LABEL: Record<string, string> = { local: 'Banco local', cbb: 'Busca CBB', tdf: 'Tabernáculo da Fé', hub: 'MessageHub', livro: 'Livro', import: 'Importada' }

const foldWords = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** Como o leitor destaca o que a busca achou: frases inteiras e palavra inteira (ou começo de palavra). */
function highlightOf(q: string, o: QueryOpts) {
  // "a b"~5 é proximidade (palavras soltas), não frase
  const quoted = [...q.matchAll(/"([^"]+)"(?!~\d)/g)].map((m) => foldWords(m[1])).filter((p) => p.length > 1)
  const exact = o.mode === 'exact' ? [foldWords(q.replace(/(^|\s)-\S+/g, ' '))].filter((p) => p.length > 1) : []
  return { phrases: [...exact, ...quoted], prefix: !o.whole_word }
}

export function MessagesPanel() {
  const { setModal, fail, focusRequest } = useApp(useShallow((s) => ({ setModal: s.setModal, fail: s.fail, focusRequest: s.focusRequest })))
  const open = useMsg((s) => s.open)
  const openGroupId = useMsg((s) => s.group?.id)
  const [view, setView] = useState<'pesquisar' | 'navegar'>('navegar')
  const [stats, setStats] = useState<MsgStats | null>(null)
  const [query, setQuery] = useState('')
  const [opts, setOpts] = useState<QueryOpts>(defaultOpts({ whole_word: true }))
  const [filters, setFilters] = useState({ yearFrom: '', yearTo: '', local: '', translations: [] as string[], sources: [] as string[], onlyPreferred: false })
  const [sort, setSort] = useState<MsgSearch['sort']>('relevance')
  const [byMessage, setByMessage] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [res, setRes] = useState<MsgResults | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  // sugestões ao digitar (palavras do índice e títulos), como o Typeahead do The Table
  const [sugg, setSugg] = useState<Suggestions | null>(null)
  const [suggOpen, setSuggOpen] = useState(false)
  const [suggIdx, setSuggIdx] = useState(-1)
  useEffect(() => {
    if (!suggOpen || query.trim().length < 2) return setSugg(null)
    const t = setTimeout(() => api.msgSuggest(query).then(setSugg).catch(() => setSugg(null)), 120)
    return () => clearTimeout(t)
  }, [query, suggOpen])
  const suggItems: ({ kind: 'pair'; word: string; phrase: string; count: number } | { kind: 'term'; word: string; count: number } | { kind: 'title'; g: GroupRow })[] = [
    // frases que continuam o que foi digitado vêm primeiro ("sete se" -> "sete selos")
    ...(sugg?.pairs ?? []).map((t) => ({ kind: 'pair' as const, ...t })),
    ...(sugg?.terms ?? []).map((t) => ({ kind: 'term' as const, ...t })),
    ...(sugg?.titles ?? []).map((g) => ({ kind: 'title' as const, g })),
  ]

  const loadStats = useCallback(() => api.msgStats().then(setStats).catch(fail), [fail])
  useEffect(() => {
    loadStats()
  }, [loadStats])
  useEffect(() => {
    if (focusRequest?.kind === 'msg-data-changed') loadStats()
    if (focusRequest?.kind === 'focus-search' && focusRequest.payload === 'mensagens') {
      setView('pesquisar')
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [focusRequest, loadStats])

  const buildQuery = (offset: number): MsgSearch => ({
    query,
    opts,
    year_from: filters.yearFrom ? +filters.yearFrom : null,
    year_to: filters.yearTo ? +filters.yearTo : null,
    local: filters.local,
    translations: filters.translations,
    sources: filters.sources,
    only_preferred: filters.onlyPreferred,
    sort,
    by_message: byMessage,
    limit: 80,
    offset,
  })

  const run = useCallback(
    async (offset = 0) => {
      if (!query.trim()) {
        setRes(null)
        return
      }
      const my = ++seq.current
      setBusy(true)
      try {
        const r = await api.msgSearch(buildQuery(offset))
        if (my !== seq.current) return
        setRes((prev) => (offset && prev ? { ...r, hits: [...prev.hits, ...r.hits], direct: prev.direct } : r))
      } catch (e) {
        if (my === seq.current) fail(e)
      } finally {
        if (my === seq.current) setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, opts, filters, sort, byMessage],
  )

  useEffect(() => {
    const t = setTimeout(() => run(0), query.trim().length >= 3 ? 220 : 500)
    return () => clearTimeout(t)
  }, [run, query])

  const saveHistory = () => {
    if (res && query.trim()) api.historyAdd('mensagens', query.trim(), JSON.stringify(opts), res.total).catch(() => {})
  }

  const openHit = (groupId: number, variantId: number | null, seqNo: number | null, project = false) => {
    saveHistory()
    open(groupId, variantId, seqNo, res?.terms ?? [], project, highlightOf(query, opts))
  }

  const applySuggestion = (s: (typeof suggItems)[number]) => {
    setSuggOpen(false)
    setSuggIdx(-1)
    if (s.kind === 'term' || s.kind === 'pair') {
      // completa a última palavra digitada (ou acrescenta a próxima, se terminou com espaço)
      setQuery((q) => q.replace(/\S*$/, s.word) + ' ')
      setTimeout(() => {
        inputRef.current?.focus()
        setSuggOpen(true)
      }, 0)
    } else openHit(s.g.id, null, null)
  }

  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const activeFilters =
    (filters.yearFrom ? 1 : 0) + (filters.yearTo ? 1 : 0) + (filters.local ? 1 : 0) + filters.translations.length + filters.sources.length + (filters.onlyPreferred ? 1 : 0)

  if (stats && stats.groups === 0) return <MessagesSetup onDone={loadStats} />

  return (
    <div className="panel msg-panel">
      <div className="subtabs top">
        <button className={view === 'navegar' ? 'on' : ''} onClick={() => setView('navegar')}>
          <Icon name="list" /> Mensagens
        </button>
        <button className={view === 'pesquisar' ? 'on' : ''} onClick={() => setView('pesquisar')}>
          <Icon name="search" /> Pesquisar
        </button>
      </div>
      {view === 'pesquisar' ? (
        <>
          <div className="panel-head">
            <div className="search-row">
              <Icon name="search" className="search-ico" />
              <input
                ref={inputRef}
                className="search"
                placeholder="Palavras, “frase”, código (65-1127B)…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSuggOpen(true)
                  setSuggIdx(-1)
                }}
                onFocus={() => setSuggOpen(true)}
                onBlur={() => setTimeout(() => setSuggOpen(false), 150)}
                onKeyDown={(e) => {
                  const open = suggOpen && suggItems.length > 0
                  if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                    e.preventDefault()
                    e.stopPropagation()
                    const n = suggItems.length
                    setSuggIdx((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n))
                    return
                  }
                  if (e.key === 'Enter') {
                    if (open && suggIdx >= 0) {
                      e.preventDefault()
                      applySuggestion(suggItems[suggIdx])
                      return
                    }
                    setSuggOpen(false)
                    run(0)
                    saveHistory()
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    if (open) setSuggOpen(false)
                    else if (query) setQuery('')
                  }
                }}
                aria-label="Pesquisar nas mensagens"
                aria-autocomplete="list"
              />
              {suggOpen && suggItems.length > 0 && (
                <ul className="typeahead" role="listbox">
                  {suggItems.map((s, i) => (
                    <li
                      key={s.kind === 'title' ? `g-${s.g.id}` : `${s.kind}-${s.word}`}
                      role="option"
                      aria-selected={i === suggIdx}
                      className={`${s.kind}${i === suggIdx ? ' sel' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        applySuggestion(s)
                      }}
                    >
                      {s.kind === 'pair' ? (
                        <>
                          <Icon name="text" size={12} /> <span>{s.phrase}</span>
                          <small title="vezes na amostra de parágrafos lida">≈ {s.count.toLocaleString('pt-BR')}</small>
                        </>
                      ) : s.kind === 'term' ? (
                        <>
                          <Icon name="search" size={12} /> <span>{s.word}</span>
                          <small>{s.count.toLocaleString('pt-BR')} §</small>
                        </>
                      ) : (
                        <>
                          <Icon name="message" size={12} /> <span className="code">{s.g.code}</span> <span>{s.g.title}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <button
                className={`icon-btn${showHistory ? ' on' : ''}`}
                title="Buscas recentes"
                onClick={async () => {
                  setShowHistory((v) => !v)
                  setHistory(await api.historyList('mensagens'))
                }}
              >
                <Icon name="history" />
              </button>
            </div>
            {showHistory && (
              <ul className="history">
                {history.map((h) => (
                  <li
                    key={h.id}
                    onClick={() => {
                      setQuery(h.query)
                      try {
                        setOpts({ ...defaultOpts(), ...JSON.parse(h.opts) })
                      } catch {
                        /* opções antigas */
                      }
                      setShowHistory(false)
                    }}
                  >
                    <span>{h.query}</span>
                    <small>{h.hits}</small>
                  </li>
                ))}
                {!history.length && <li className="empty">Sem buscas recentes.</li>}
                {history.length > 0 && (
                  <li className="clear-history" onClick={() => api.historyClear('mensagens').then(() => setHistory([]))}>
                    Limpar histórico
                  </li>
                )}
              </ul>
            )}
            <ModeSwitch opts={opts} onChange={setOpts} />
            <OptionChecks opts={opts} onChange={setOpts} compact />
            <div className="filter-bar">
              <button className={`chip${showFilters || activeFilters ? ' on' : ''}`} onClick={() => setShowFilters((v) => !v)}>
                <Icon name="filter" size={13} /> Filtros{activeFilters ? ` (${activeFilters})` : ''}
              </button>
              <select value={sort} onChange={(e) => setSort(e.target.value as MsgSearch['sort'])} aria-label="Ordenar por">
                <option value="relevance">Relevância</option>
                <option value="date">Data</option>
                <option value="title">Título</option>
                <option value="local">Local</option>
              </select>
              <label className="chip-check" title="Uma linha por mensagem, com o número de ocorrências">
                <input type="checkbox" checked={byMessage} onChange={(e) => setByMessage(e.target.checked)} /> Por mensagem
              </label>
            </div>
            {showFilters && stats && (
              <div className="filters">
                <div className="frow">
                  <span>Anos</span>
                  <input type="number" placeholder={String(stats.year_min ?? 1947)} value={filters.yearFrom} onChange={(e) => setFilters({ ...filters, yearFrom: e.target.value })} />
                  <span>a</span>
                  <input type="number" placeholder={String(stats.year_max ?? 1965)} value={filters.yearTo} onChange={(e) => setFilters({ ...filters, yearTo: e.target.value })} />
                </div>
                <div className="frow">
                  <span>Local</span>
                  <input placeholder="Jeffersonville, Phoenix…" value={filters.local} onChange={(e) => setFilters({ ...filters, local: e.target.value })} />
                </div>
                <div className="frow wrap">
                  <span>Tradução</span>
                  {stats.translations.map(([t, n]) => (
                    <button key={t} className={`chip${filters.translations.includes(t) ? ' on' : ''}`} onClick={() => setFilters({ ...filters, translations: toggleIn(filters.translations, t) })} title={`${n} mensagens`}>
                      {t}
                    </button>
                  ))}
                </div>
                <div className="frow wrap">
                  <span>Fonte</span>
                  {stats.by_source.map(([s, n]) => (
                    <button key={s} className={`chip${filters.sources.includes(s) ? ' on' : ''}`} onClick={() => setFilters({ ...filters, sources: toggleIn(filters.sources, s) })} title={`${n} traduções`}>
                      {SOURCE_LABEL[s] ?? s}
                    </button>
                  ))}
                </div>
                <label className="frow">
                  <input type="checkbox" checked={filters.onlyPreferred} onChange={(e) => setFilters({ ...filters, onlyPreferred: e.target.checked })} />
                  Só a tradução escolhida de cada mensagem
                </label>
                <button className="link" onClick={() => setFilters({ yearFrom: '', yearTo: '', local: '', translations: [], sources: [], onlyPreferred: false })}>
                  Limpar filtros
                </button>
              </div>
            )}
            <div className="list-meta">
              <span>{busy ? 'Pesquisando…' : res ? `${res.total} ${byMessage ? 'mensage' + (res.total === 1 ? 'm' : 'ns') : 'parágrafo' + (res.total === 1 ? '' : 's')}` : SYNTAX_HELP}</span>
            </div>
          </div>
          <ul className="result-list msg-results">
            {res?.direct.map((g) => (
              <GroupLine key={`d${g.id}`} g={g} active={g.id === openGroupId} onOpen={(p) => openHit(g.id, null, null, p)} direct />
            ))}
            {res?.hits.map((h) => (
              <li
                key={`${h.paragraph_id}`}
                className={h.group_id === openGroupId ? 'open' : ''}
                onClick={() => openHit(h.group_id, h.variant_id, h.seq)}
                onDoubleClick={() => openHit(h.group_id, h.variant_id, h.seq, true)}
                title="Clique para ler • duplo clique para projetar o parágrafo"
              >
                <div className="r-title">
                  <span className="code">{h.code}</span> {h.title}
                </div>
                <div className="r-sub">
                  <span className="badge">{h.translation || '—'}</span>
                  {h.source !== 'local' && <span className="badge src">{SOURCE_LABEL[h.source] ?? h.source}</span>}
                  {byMessage ? <span>{h.hits} ocorrência{h.hits === 1 ? '' : 's'}</span> : <span>§{h.num}</span>}
                  {h.local && <span className="muted">{h.local}</span>}
                </div>
                <div className="r-snippet">
                  <Marked text={h.marked} />
                </div>
              </li>
            ))}
            {res && res.hits.length < res.total && (
              <li className="more" onClick={() => run(res.hits.length)}>
                Mostrar mais ({res.total - res.hits.length} restantes)
              </li>
            )}
            {res && !res.total && !res.direct.length && <li className="empty">Nada encontrado. Experimente “Variações”, “Aproximada” ou o modo “Qualquer”.</li>}
          </ul>
        </>
      ) : (
        <MessageBrowser onOpen={(id, p) => open(id, null, null, [], p)} activeId={openGroupId} />
      )}
      <div className="panel-foot stats-foot">
        {stats && (
          <span title={`${stats.paragraphs.toLocaleString('pt-BR')} parágrafos`}>
            {stats.with_text} com texto · {stats.multi} com várias traduções
          </span>
        )}
        <button onClick={() => setModal({ type: 'settings', tab: 'mensagens' })} title="Fontes: banco local, Busca CBB, Tabernáculo da Fé">
          <Icon name="sync" /> Fontes
        </button>
      </div>
    </div>
  )
}

function GroupLine({ g, onOpen, active, direct }: { g: GroupRow; onOpen: (project: boolean) => void; active?: boolean; direct?: boolean }) {
  const trs = g.translations ? g.translations.split(',') : []
  return (
    <li className={`group-line${active ? ' open' : ''}${direct ? ' direct' : ''}`} onClick={() => onOpen(false)} onDoubleClick={() => onOpen(true)}>
      <div className="r-title">
        <span className="code">{g.code}</span> {g.title}
      </div>
      <div className="r-sub">
        {trs.length ? trs.map((t) => <span key={t} className="badge">{t}</span>) : <span className="muted">sem texto em português</span>}
        {g.with_text > 1 && <span className="badge multi">{g.with_text} traduções{g.chosen ? ' ✓' : ''}</span>}
        {g.local && <span className="muted">{g.local}</span>}
      </div>
    </li>
  )
}

function MessageBrowser({ onOpen, activeId }: { onOpen: (id: number, project: boolean) => void; activeId?: number }) {
  const { fail } = useApp(useShallow((s) => ({ fail: s.fail })))
  const [filter, setFilter] = useState('')
  const [onlyText, setOnlyText] = useState(true)
  const [onlyMulti, setOnlyMulti] = useState(false)
  const [sort, setSort] = useState('date')
  /** Só a série dos Selos ou só os capítulos do livro das Eras. */
  const [collection, setCollection] = useState<'' | 'selos' | 'eras'>('')
  const [rows, setRows] = useState<GroupRow[]>([])
  const [total, setTotal] = useState(0)

  const load = useCallback(
    async (offset = 0) => {
      try {
        const r = await api.msgList({ filter, only_with_text: onlyText, only_multi: onlyMulti, sort, limit: 300, offset, collection })
        setTotal(r.total)
        setRows((prev) => (offset ? [...prev, ...r.rows] : r.rows))
      } catch (e) {
        fail(e)
      }
    },
    [filter, onlyText, onlyMulti, sort, collection, fail],
  )
  useEffect(() => {
    const t = setTimeout(() => load(0), 150)
    return () => clearTimeout(t)
  }, [load])

  return (
    <>
      <div className="panel-head">
        <div className="search-row">
          <Icon name="search" className="search-ico" />
          <input className="search" placeholder="Título, local ou data (58-0309, 1963)…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar mensagens" />
        </div>
        <div className="filter-bar">
          <label className="chip-check">
            <input type="checkbox" checked={onlyText} onChange={(e) => setOnlyText(e.target.checked)} /> Com texto
          </label>
          <label className="chip-check" title="Mensagens com mais de uma tradução disponível">
            <input type="checkbox" checked={onlyMulti} onChange={(e) => setOnlyMulti(e.target.checked)} /> Várias traduções
          </label>
          <div className="seg collections" role="group" aria-label="Coleções">
            <button className={collection === 'selos' ? 'on' : ''} onClick={() => setCollection(collection === 'selos' ? '' : 'selos')} title="Só a série dos Sete Selos (63-0317 a 63-0324)">
              Selos
            </button>
            <button className={collection === 'eras' ? 'on' : ''} onClick={() => setCollection(collection === 'eras' ? '' : 'eras')} title="Só os capítulos do livro Uma Exposição das Sete Eras da Igreja (ERAS-01 a ERAS-10)">
              Eras
            </button>
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
            <option value="date">Data ↑</option>
            <option value="date_desc">Data ↓</option>
            <option value="title">Título</option>
            <option value="local">Local</option>
          </select>
        </div>
        <div className="list-meta">
          <span>
            {total} mensage{total === 1 ? 'm' : 'ns'}
            {collection === 'eras' && total === 0 && ' — importe o zip das Eras em Configurações → Mensagens → Livros e séries'}
          </span>
        </div>
      </div>
      <ul className="result-list">
        {rows.map((g) => (
          <GroupLine key={g.id} g={g} active={g.id === activeId} onOpen={(p) => onOpen(g.id, p)} />
        ))}
        {rows.length < total && (
          <li className="more" onClick={() => load(rows.length)}>
            Mostrar mais ({total - rows.length})
          </li>
        )}
      </ul>
    </>
  )
}

/** Primeira vez: importar o banco local e baixar o Busca CBB. */
function MessagesSetup({ onDone }: { onDone: () => void }) {
  const { fail, toast, request } = useApp(useShallow((s) => ({ fail: s.fail, toast: s.toast, request: s.request })))
  const [path, setPath] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  useEffect(() => {
    api.msgDefaultLocalPath().then(setPath).catch(() => {})
  }, [])
  const importLocal = async () => {
    if (!path) return
    setBusy('Importando o banco local…')
    try {
      const r = await api.msgImportLocal(path)
      toast(`${r.with_text} mensagens com texto importadas (${r.paragraphs.toLocaleString('pt-BR')} parágrafos)`, 'ok')
      request('msg-data-changed', null)
      onDone()
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="panel">
      <div className="setup-card">
        <Icon name="message" size={34} />
        <h3>Mensagens</h3>
        <p>Nenhuma mensagem ainda. Importe o banco local e, se quiser, baixe também as traduções do Busca CBB e do Tabernáculo da Fé em Configurações → Mensagens.</p>
        {path ? (
          <>
            <code className="path">{path}</code>
            <button className="primary" onClick={importLocal} disabled={!!busy}>
              {busy || 'Importar banco local'}
            </button>
          </>
        ) : (
          <p className="hint">Banco local não encontrado automaticamente.</p>
        )}
        <button onClick={() => useApp.getState().setModal({ type: 'settings', tab: 'mensagens' })}>Abrir fontes de mensagens</button>
      </div>
    </div>
  )
}
