// Centro na aba Bíblia: versículos do capítulo (até 3 versões lado a lado). Clique projeta;
// Ctrl+clique soma versículos, Shift+clique escolhe um trecho (projetados juntos ou em sequência).
import { useEffect, useRef } from 'react'
import { api } from '../api'
import { addCurrentToPlaylist } from '../lib/open'
import { holyricsId, rangeLabel } from '../lib/slides'
import { slideIndexOfVerse, useBible } from '../state/bible'
import { useApp } from '../store'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

export function BibleCenter() {
  const { item, cursor, setCursor, live, liveIndex, project, bibles, books, settings, saveSettings, toast, fail } = useApp(useShallow((s) => ({ item: s.item, cursor: s.cursor, setCursor: s.setCursor, live: s.live, liveIndex: s.liveIndex, project: s.project, bibles: s.bibles, books: s.books, settings: s.settings, saveSettings: s.saveSettings, toast: s.toast, fail: s.fail })))
  const { book, chapter, verses, go, loading, shown, fallback, needConfirm, sel, pick, clearSel, projectSelection, confirmProject, favs, toggleFav } = useBible(useShallow((s) => ({ book: s.book, chapter: s.chapter, verses: s.verses, go: s.go, loading: s.loading, shown: s.shown, fallback: s.fallback, needConfirm: s.needConfirm, sel: s.sel, pick: s.pick, clearSel: s.clearSel, projectSelection: s.projectSelection, confirmProject: s.confirmProject, favs: s.favs, toggleFav: s.toggleFav })))
  const listRef = useRef<HTMLDivElement>(null)
  // versões realmente mostradas (a primeira pode ser a reserva, quando a escolhida não tem o livro)
  const versions = shown.filter((v) => bibles.some((b) => b.id === v))
  const info = books.find((b) => b.id === book)
  const isChapter = !!item && item.kind === 'verse' && item.ref.book === book && item.ref.chapter === chapter && !item.ref.verses
  const liveVerses = live?.kind === 'verse' && live.ref.book === book && live.ref.chapter === chapter ? live.slides[liveIndex]?.refs?.map((r) => r.verse) ?? [live.slides[liveIndex]?.ref?.verse] : []
  const curVerse = isChapter ? item!.slides[cursor]?.ref?.verse : undefined
  const abbrev = (id: string) => bibles.find((b) => b.id === id)?.abbrev ?? id

  // capítulo/referência nova: centraliza; clique ou setas no mesmo capítulo: só o necessário para aparecer
  const lastKey = useRef<string | undefined>(undefined)
  useEffect(() => {
    const changed = lastKey.current !== item?.key
    lastKey.current = item?.key
    listRef.current?.querySelector('.verse-row.cursor')?.scrollIntoView({ block: changed ? 'center' : 'nearest' })
  }, [cursor, item?.key])

  useEffect(() => {
    if (liveVerses.length) listRef.current?.querySelector('.verse-row.live')?.scrollIntoView({ block: 'nearest' })
  }, [liveIndex, live?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!bibles.length) return <div className="center-empty"><Icon name="book" size={40} /><p>Instale uma Bíblia em Configurações → Bíblias.</p></div>
  if (!info) return null

  const toHolyrics = async () => {
    const vs = sel.length > 1 ? sel : curVerse != null ? [curVerse] : []
    if (!vs.length) return
    try {
      await api.holyricsShowVerse(vs.map((v) => holyricsId(book, chapter, v)), settings.holyricsVersion || undefined)
      toast(`${info.name} ${chapter}:${rangeLabel(vs)} enviado ao Holyrics`, 'ok')
    } catch (e) {
      fail(e)
    }
  }

  const licenses = versions.map((v) => bibles.find((b) => b.id === v)).filter(Boolean)
  const mark = { book, chapter, verse: sel[0] ?? curVerse ?? 1, verses: sel.length > 1 ? sel : undefined, bible: shown[0] }
  const isFav = favs.some((f) => f.book === mark.book && f.chapter === mark.chapter && (f.verses?.join() ?? String(f.verse)) === (mark.verses?.join() ?? String(mark.verse)))

  return (
    <div className="bible-center">
      <div className="center-head">
        <div className="center-title">
          <h1>
            {info.name} {chapter}
            {sel.length > 1 && <span className="sel-tag">:{rangeLabel(sel)}</span>}
          </h1>
          <span>{versions.map(abbrev).join(' · ')}</span>
        </div>
        <div className="toolbar">
          <button onClick={() => (chapter > 1 ? go(book, chapter - 1) : book > 1 && go(book - 1, books[book - 2].chapters))} title="Capítulo anterior">
            <Icon name="prev" />
          </button>
          <button onClick={() => (chapter < info.chapters ? go(book, chapter + 1) : book < 66 && go(book + 1, 1))} title="Próximo capítulo">
            <Icon name="next" />
          </button>
          <button
            className="primary"
            onClick={projectSelection}
            disabled={!isChapter}
            title={sel.length > 1 ? `Projetar ${info.name} ${chapter}:${rangeLabel(sel)} (${settings.bibleRangeMode === 'juntos' ? 'juntos' : 'em sequência'})` : 'Projetar versículo selecionado (Enter)'}
          >
            <Icon name="play" /> Projetar
          </button>
          <button onClick={addCurrentToPlaylist} disabled={!isChapter} title="Adicionar à lista (o trecho escolhido, se houver)">
            <Icon name="list" /> Lista
          </button>
          <button className={isFav ? 'on' : ''} onClick={() => toggleFav(mark)} disabled={!isChapter} title={isFav ? 'Tirar dos favoritos' : 'Guardar nos favoritos'}>
            <Icon name="star" />
          </button>
          <button className={settings.bibleOnlyRef ? 'on' : ''} onClick={() => saveSettings({ bibleOnlyRef: !settings.bibleOnlyRef })} title="Projetar só a referência (ex.: João 3:16), sem o texto">
            Só ref.
          </button>
          <button onClick={toHolyrics} disabled={!isChapter} title="Projetar no Holyrics, com a Bíblia dele (API)">
            <Icon name="send" /> Holyrics
          </button>
        </div>
      </div>
      {fallback && (
        <div className="banner fallback">
          A {abbrev(fallback.missing)} ainda não tem {info.name} (tradução incompleta). Mostrando {abbrev(fallback.using)}.
          {needConfirm && (
            <>
              {' '}Não foi projetado porque está noutra língua.{' '}
              <button className="small" onClick={confirmProject}>
                Projetar em {abbrev(fallback.using)} mesmo assim
              </button>
            </>
          )}
        </div>
      )}
      {settings.bibleViaHolyrics && (
        <div className="banner holyrics">
          Projetando pelo Holyrics{settings.holyricsVersion ? ` (${settings.holyricsVersion})` : ''}: duplo clique no versículo (ou Enter) e ele aparece no Holyrics. O texto abaixo é só para
          navegar ({versions.map(abbrev).join(', ')}).
        </div>
      )}
      {sel.length > 1 && (
        <div className="banner sel">
          {sel.length} versículos escolhidos ({rangeLabel(sel)}): Enter ou "Projetar" mostra {settings.bibleRangeMode === 'juntos' ? 'todos juntos' : 'um por slide'}.{' '}
          <button className="small" onClick={clearSel}>
            Limpar
          </button>
        </div>
      )}
      <div className={`verse-list cols-${versions.length}`} ref={listRef}>
        {!verses.length &&
          (loading ? (
            <div className="center-empty">Carregando {info.name} {chapter}…</div>
          ) : (
            <div className="center-empty">
              Nenhuma Bíblia instalada tem {info.name} {chapter}.
            </div>
          ))}
        {versions.length > 1 && (
          <div className="verse-cols-head">
            <span />
            {versions.map((v) => (
              <span key={v}>{abbrev(v)}</span>
            ))}
          </div>
        )}
        {verses.map((v) => (
          <div
            key={v.verse}
            className={`verse-row${liveVerses.includes(v.verse) ? ' live' : ''}${v.verse === curVerse ? ' cursor' : ''}${sel.includes(v.verse) ? ' picked' : ''}`}
            // Shift/Ctrl+clique escolhe versículos (e o duplo clique projeta): não deixa o navegador selecionar o texto junto
            onMouseDown={(e) => (e.shiftKey || e.ctrlKey || e.metaKey || e.detail > 1) && e.preventDefault()}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) return pick(v.verse, 'toggle')
              if (e.shiftKey) return pick(v.verse, 'range')
              clearSel()
              // clique = prévia; duplo clique (ou Enter) projeta, como na lista
              const it = isChapter ? item : null
              const i = it ? slideIndexOfVerse(it, v.verse) : -1
              if (it && i >= 0) setCursor(i)
            }}
            onDoubleClick={(e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey) return
              const it = isChapter ? item : null
              const i = it ? slideIndexOfVerse(it, v.verse) : -1
              if (it && i >= 0) {
                setCursor(i)
                project(it, i)
              }
            }}
            role="button"
            tabIndex={-1}
            title="Clique: prévia • duplo clique ou Enter: projetar • Ctrl+clique soma versículos • Shift+clique escolhe um trecho"
          >
            <span className="vnum">{v.verse}</span>
            {v.texts.map((t, k) => (
              <span key={k} className="vtext">
                {t ?? <em className="hint">—</em>}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="license">
        {licenses.map((b) => (
          <span key={b!.id}>
            {b!.abbrev}: {b!.name}
            {b!.license ? ` — ${b!.license}` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
