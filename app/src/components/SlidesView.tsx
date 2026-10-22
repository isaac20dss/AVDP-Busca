// Centro: slides do item aberto (música ou texto). Clique projeta, como no Holyrics.
import { useEffect, useRef } from 'react'
import { api } from '../api'
import { keysFor, prettyCombo, type ActionId } from '../lib/hotkeys'
import { useApp } from '../store'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

export function SlidesView() {
  const { item, cursor, setCursor, live, liveIndex, project, step, addToPlaylist, setModal, fail, toast, settings } = useApp(useShallow((s) => ({ item: s.item, cursor: s.cursor, setCursor: s.setCursor, live: s.live, liveIndex: s.liveIndex, project: s.project, step: s.step, addToPlaylist: s.addToPlaylist, setModal: s.setModal, fail: s.fail, toast: s.toast, settings: s.settings })))
  const gridRef = useRef<HTMLDivElement>(null)
  const isLive = !!item && live?.key === item.key
  // tecla configurada em Configurações → Atalhos (a primeira de cada ação)
  const k = (id: ActionId) => prettyCombo(keysFor(id, settings.hotkeys)[0] ?? '')

  useEffect(() => {
    gridRef.current?.querySelector('.slide-card.live, .slide-card.cursor')?.scrollIntoView({ block: 'nearest' })
  }, [liveIndex, cursor, item?.key])

  if (!item || (item.kind !== 'song' && item.kind !== 'text'))
    return (
      <div className="center-empty">
        <Icon name="music" size={40} />
        <p>Escolha uma música ou texto à esquerda.</p>
        <p className="hint">
          Clique num slide para projetar • <kbd>{k('next')}</kbd> próximo • <kbd>{k('prev')}</kbd> anterior • <kbd>{k('black')}</kbd> tela preta • <kbd>{k('exit')}</kbd>{' '}
          encerrar • <kbd>{k('searchGlobal')}</kbd> busca geral
        </p>
      </div>
    )

  const edit = async () => {
    try {
      if (item.kind === 'song') setModal({ type: 'song', song: await api.songGet(item.ref.id as number) })
      else setModal({ type: 'text', id: item.ref.id as number })
    } catch (e) {
      fail(e)
    }
  }

  const toHolyrics = async () => {
    try {
      await api.holyricsShowSlides(item.slides.filter((s) => !s.title).map((s) => s.text))
      toast('Enviado ao Holyrics', 'ok')
    } catch (e) {
      fail(e)
    }
  }

  return (
    <div className="slides-view">
      <div className="center-head">
        <div className="center-title">
          <h1>{item.title}</h1>
          {item.subtitle && <span>{item.subtitle}</span>}
        </div>
        <div className="toolbar">
          <button className="primary" onClick={() => project(item, cursor)} title="Projetar slide selecionado (Enter)">
            <Icon name="play" /> Projetar
          </button>
          <button
            onClick={() => (isLive ? step(1) : project(item, cursor))}
            disabled={isLive && liveIndex >= item.slides.length - 1}
            title={isLive ? 'Próximo slide' : 'Começar pelo slide selecionado'}
          >
            <Icon name="next" />
          </button>
          <button onClick={() => addToPlaylist(item)} title="Adicionar à lista de reprodução">
            <Icon name="list" /> Lista
          </button>
          <button onClick={edit} title="Editar (F2)">
            <Icon name="edit" /> Editar
          </button>
          <button onClick={toHolyrics} title="Mostrar no Holyrics (apresentação rápida, pela API)">
            <Icon name="send" /> Holyrics
          </button>
        </div>
      </div>
      <div className="slide-grid" ref={gridRef}>
        {item.slides.map((s, i) => (
          <button
            key={i}
            className={`slide-card${isLive && i === liveIndex ? ' live' : ''}${i === cursor ? ' cursor' : ''}${s.title ? ' title' : ''}`}
            onClick={() => {
              setCursor(i)
              project(item, i)
            }}
            onKeyDown={(e) => e.key === 'F2' && edit()}
          >
            <span className="slide-label">{s.label}</span>
            <span className="slide-text">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
