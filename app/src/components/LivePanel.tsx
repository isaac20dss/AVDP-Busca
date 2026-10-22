// Direita em cima: o que está no telão + próximo slide + tema.
import { useMemo } from 'react'
import { parseTheme } from '../lib/theme'
import { continuation } from '../state/bible'
import { displaySlide, useApp } from '../store'
import { Icon } from './icons'
import { SlideRender } from './SlideRender'
import { useShallow } from 'zustand/react/shallow'

const KIND_LABEL = { song: 'Letras', verse: 'Bíblia', message: 'Mensagens', text: 'Textos', media: 'Mídia' } as const

export function LivePanel() {
  const { live, liveIndex, blank, settings, themes, saveSettings, setModal, step, item, liveViaHolyrics } = useApp(useShallow((s) => ({ live: s.live, liveIndex: s.liveIndex, blank: s.blank, settings: s.settings, themes: s.themes, saveSettings: s.saveSettings, setModal: s.setModal, step: s.step, item: s.item, liveViaHolyrics: s.liveViaHolyrics })))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const theme = useMemo(() => useApp.getState().liveTheme(), [live, settings, themes])
  const slide = live?.slides[liveIndex] ?? null
  // no fim de um trecho da Bíblia, o próximo é o versículo seguinte do capítulo
  const cont = live && liveIndex >= live.slides.length - 1 ? continuation(live, 1) : null
  const next = live?.slides[liveIndex + 1] ?? (cont ? cont.chapter.slides[cont.index] : null)
  const kind = live?.kind ?? item?.kind ?? 'song'
  // a música com tema próprio usa o dela; o seletor mostra (e troca) o tema que está de fato na tela
  const ownTheme = live?.themeId ?? null
  const themeId = ownTheme ?? settings.themeByKind[kind] ?? themes[0]?.id
  const chooseTheme = (id: number) => {
    if (live && ownTheme != null) {
      useApp.setState({ live: { ...live, themeId: id } })
      useApp.getState().sendLive()
    } else saveSettings({ themeByKind: { ...settings.themeByKind, [kind]: id } })
  }
  const shown = displaySlide(live, slide, settings)

  return (
    <section className="live-panel">
      <div className="live-head">
        <span className={`live-dot${live && blank === 'none' ? ' on' : ''}`} /> Ao vivo
        {live && (
          <span className="live-what" title={live.title}>
            {live.title} · {slide?.label ?? ''} ({liveIndex + 1}/{live.slides.length})
          </span>
        )}
      </div>
      <div className="preview-frame">
        <SlideRender
          slide={shown}
          theme={blank === 'logo' && settings.wallpaperImage ? { ...theme, bg: { kind: 'image', image: settings.wallpaperImage } } : theme}
          blank={live || blank === 'logo' ? blank : 'black'}
          logoText={settings.logoText}
        />
        {blank !== 'none' && <span className="blank-tag">{blank === 'black' ? 'TELA PRETA (F10)' : blank === 'logo' ? 'PAPEL DE PAREDE (F8)' : 'SEM TEXTO (F9)'}</span>}
        {liveViaHolyrics && <span className="holyrics-tag">No Holyrics: {slide?.footer}</span>}
      </div>
      <div className="live-nav">
        <button onClick={() => step(-1)} disabled={!live || liveIndex === 0} title="Anterior (←)">
          <Icon name="prev" />
        </button>
        <div className="next-preview" title="Próximo slide">
          <span>Próximo</span>
          <div className="next-text">{next ? next.text.split('\n').slice(0, 3).join(' / ') : '—'}</div>
        </div>
        <button onClick={() => step(1)} disabled={!live || (liveIndex >= (live?.slides.length ?? 1) - 1 && !cont)} title="Próximo (→)">
          <Icon name="next" />
        </button>
      </div>
      <div className="theme-row">
        <Icon name="palette" />
        <select
          value={themeId ?? ''}
          onChange={(e) => chooseTheme(+e.target.value)}
          title={ownTheme != null ? 'Tema próprio deste item' : `Tema usado em ${KIND_LABEL[kind]}`}
        >
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="hint">{KIND_LABEL[kind]}</span>
        <button
          className="icon-btn"
          title="Editar tema"
          onClick={() => {
            const row = themes.find((t) => t.id === themeId)
            if (row) setModal({ type: 'theme', theme: row })
          }}
        >
          <Icon name="edit" />
        </button>
      </div>
      <div className="theme-strip">
        {themes.map((t) => (
          <button
            key={t.id}
            className={`theme-thumb${t.id === themeId ? ' on' : ''}`}
            title={t.name}
            onClick={() => chooseTheme(t.id)}
          >
            <SlideRender slide={{ text: 'Aa' }} theme={{ ...parseTheme(t), size: 42, padding: 2, paddingTop: 2, paddingBottom: 2, paddingSide: 2.4, footer: { ...parseTheme(t).footer, show: false } }} />
          </button>
        ))}
        <button
          className="theme-thumb add"
          title="Novo tema"
          onClick={() => setModal({ type: 'theme', theme: { id: 0, name: 'Novo tema', data: themes.find((t) => t.id === themeId)?.data ?? '{}' } })}
        >
          <Icon name="plus" />
        </button>
      </div>
    </section>
  )
}
