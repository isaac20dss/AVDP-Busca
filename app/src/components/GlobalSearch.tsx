// Busca geral (Ctrl+K): referência bíblica, músicas, mensagens (código/título), versículos e parágrafos.
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { openRef } from '../lib/open'
import { useBible } from '../state/bible'
import { useMsg } from '../state/msg'
import { useApp } from '../store'
import { defaultOpts, type GroupRow, type MsgHit, type SongHit, type VerseHit, type VerseRef } from '../types'
import { Marked } from './Marked'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

interface Entry {
  key: string
  section: string
  title: string
  sub?: string
  marked?: string
  run: (project: boolean) => void
}

export function GlobalSearch() {
  const { setModal, books, settings, setTab } = useApp(useShallow((s) => ({ setModal: s.setModal, books: s.books, settings: s.settings, setTab: s.setTab })))
  const [q, setQ] = useState('')
  const [ref, setRef] = useState<VerseRef | null>(null)
  const [songs, setSongs] = useState<SongHit[]>([])
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [paras, setParas] = useState<MsgHit[]>([])
  const [verses, setVerses] = useState<VerseHit[]>([])
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  const close = () => setModal(null)

  useEffect(() => inputRef.current?.focus(), [])

  useEffect(() => {
    const my = ++seq.current
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setRef(null)
        setSongs([])
        setGroups([])
        setParas([])
        setVerses([])
        return
      }
      const bible = settings.bibleVersions[0]
      const [r, s, m, v] = await Promise.all([
        /\d/.test(q) ? api.bibleParseRef(q).catch(() => null) : Promise.resolve(null),
        api.songsSearch(q, defaultOpts(), '').catch(() => null),
        q.trim().length >= 3
          ? api.msgSearch({ query: q, opts: defaultOpts({ whole_word: true }), year_from: null, year_to: null, local: '', translations: [], sources: [], only_preferred: true, sort: 'relevance', by_message: false, limit: 6, offset: 0 }).catch(() => null)
          : Promise.resolve(null),
        bible && q.trim().length >= 3 ? api.bibleSearch({ query: q, opts: defaultOpts({ whole_word: true }), bible, scope: 'all', book: 0, limit: 6 }).catch(() => null) : Promise.resolve(null),
      ])
      if (my !== seq.current) return
      setRef(r)
      setSongs(s?.hits.slice(0, 8) ?? [])
      setGroups(m?.direct.slice(0, 5) ?? [])
      setParas(m?.hits ?? [])
      setVerses(v?.hits ?? [])
      setSel(0)
    }, 120)
    return () => clearTimeout(t)
  }, [q, settings.bibleVersions])

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    if (ref) {
      const b = books.find((x) => x.id === ref.book)
      out.push({
        key: 'ref',
        section: 'Bíblia',
        title: `${b?.name} ${ref.chapter}${ref.verse ? ':' + ref.verse : ''}${ref.verse_end ? '-' + ref.verse_end : ''}`,
        sub: 'Abrir referência',
        run: (p) => {
          setTab('biblia')
          const range = ref.verse != null && ref.verse_end != null && ref.verse_end > ref.verse ? Array.from({ length: ref.verse_end - ref.verse + 1 }, (_, i) => ref.verse! + i) : []
          useBible.getState().go(ref.book, ref.chapter, ref.verse ?? null, p && ref.verse != null, range)
        },
      })
    }
    songs.forEach((s) =>
      out.push({ key: `s${s.id}`, section: 'Músicas', title: s.title, sub: s.artist, marked: s.marked, run: (p) => openRef('song', { id: s.id }, p) }),
    )
    groups.forEach((g) =>
      out.push({
        key: `g${g.id}`,
        section: 'Mensagens',
        title: `${g.code} ${g.title}`,
        sub: g.translations,
        run: (p) => {
          setTab('mensagens')
          useMsg.getState().open(g.id, null, null, [], p)
        },
      }),
    )
    verses.forEach((v) =>
      out.push({
        key: `v${v.book}-${v.chapter}-${v.verse}`,
        section: 'Versículos',
        title: v.reference,
        marked: v.marked,
        run: (p) => {
          setTab('biblia')
          useBible.getState().go(v.book, v.chapter, v.verse, p)
        },
      }),
    )
    paras.forEach((h) =>
      out.push({
        key: `p${h.paragraph_id}`,
        section: 'Parágrafos',
        title: `${h.code} ${h.title} §${h.num}`,
        sub: h.translation,
        marked: h.marked,
        run: (p) => {
          setTab('mensagens')
          useMsg.getState().open(h.group_id, h.variant_id, h.seq, [], p)
        },
      }),
    )
    return out
  }, [ref, songs, groups, verses, paras, books, setTab])

  const go = (e: Entry, project: boolean) => {
    close()
    e.run(project)
  }

  let lastSection = ''
  return (
    <div className="modal-back top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Busca geral">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Música, referência (jo 3 16), código de mensagem (65-1127), palavras…"
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(s + 1, entries.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(s - 1, 0))
              } else if (e.key === 'Enter' && entries[sel]) go(entries[sel], e.ctrlKey || e.metaKey)
            }}
          />
          <kbd>Enter</kbd> abrir · <kbd>Ctrl+Enter</kbd> projetar
        </div>
        <ul className="palette-list">
          {entries.map((e, i) => {
            const head = e.section !== lastSection ? e.section : null
            lastSection = e.section
            return (
              <li key={e.key}>
                {head && <div className="palette-section">{head}</div>}
                <div className={`palette-item${i === sel ? ' sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(e, false)}>
                  <div className="r-title">{e.title}</div>
                  {e.sub && <div className="r-sub">{e.sub}</div>}
                  {e.marked && (
                    <div className="r-snippet">
                      <Marked text={e.marked} />
                    </div>
                  )}
                </div>
              </li>
            )
          })}
          {q.trim() && !entries.length && <li className="empty">Nada encontrado.</li>}
        </ul>
      </div>
    </div>
  )
}
