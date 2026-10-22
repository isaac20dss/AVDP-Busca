// Direita, embaixo do Ao vivo: prévia do slide escolhido no centro (ainda não está no ar).
// Clique na prévia, Enter ou "Projetar" põe no ar; as setas da prévia escolhem outro slide.
import { useMemo } from 'react'
import { keysFor, prettyCombo } from '../lib/hotkeys'
import { projectPreview } from '../lib/open'
import { parseTheme } from '../lib/theme'
import { useBible } from '../state/bible'
import { displaySlide, useApp } from '../store'
import { Icon } from './icons'
import { SlideRender } from './SlideRender'
import { useShallow } from 'zustand/react/shallow'

export function PreviewPanel() {
  const { item, cursor, setCursor, live, liveIndex, settings, themes, tab } = useApp(useShallow((s) => ({ item: s.item, cursor: s.cursor, setCursor: s.setCursor, live: s.live, liveIndex: s.liveIndex, settings: s.settings, themes: s.themes, tab: s.tab })))
  const sel = useBible((s) => s.sel)
  const kind = item?.kind ?? 'song'
  const themeId = item?.themeId ?? settings.themeByKind[kind] ?? themes[0]?.id
  const theme = useMemo(() => parseTheme(themes.find((t) => t.id === themeId) ?? themes[0]), [themes, themeId])
  const slide = item?.slides[cursor] ?? null
  const shown = displaySlide(item, slide, settings)
  const onAir = !!item && live?.key === item.key && liveIndex === cursor
  const isRange = tab === 'biblia' && kind === 'verse' && sel.length > 1
  const enter = prettyCombo(keysFor('projectSelected', settings.hotkeys)[0] ?? 'Enter')
  const move = (d: number) => item && setCursor(Math.max(0, Math.min(cursor + d, item.slides.length - 1)))

  return (
    <section className="live-panel preview-panel">
      <div className="live-head">
        <span className="preview-dot" /> Prévia
        {item && (
          <span className="live-what" title={item.title}>
            {isRange ? `${sel.length} versículos escolhidos` : `${item.title} · ${slide?.label ?? ''} (${cursor + 1}/${item.slides.length})`}
          </span>
        )}
      </div>
      <div
        className={`preview-frame clickable${onAir ? ' on-air' : ''}`}
        onClick={() => item && projectPreview()}
        title={item ? `Clique (ou ${enter}) para pôr no ar` : ''}
        role="button"
      >
        <SlideRender slide={shown} theme={theme} blank={item ? 'none' : 'black'} logoText={settings.logoText} />
        {onAir && <span className="air-tag">NO AR</span>}
      </div>
      <div className="live-nav">
        <button onClick={() => move(-1)} disabled={!item || cursor === 0} title="Slide anterior na prévia">
          <Icon name="prev" />
        </button>
        <button className="primary preview-go" onClick={projectPreview} disabled={!item} title={`Pôr a prévia no ar (${enter})`}>
          <Icon name="play" /> Projetar
        </button>
        <button onClick={() => move(1)} disabled={!item || cursor >= (item?.slides.length ?? 1) - 1} title="Próximo slide na prévia">
          <Icon name="next" />
        </button>
      </div>
    </section>
  )
}
