import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/lato/400.css'
import '@fontsource/lato/700.css'
import '@fontsource/open-sans/400.css'
import '@fontsource/open-sans/700.css'
import '@fontsource/merriweather/400.css'
import '@fontsource/merriweather/700.css'
import '@fontsource/roboto-slab/400.css'
import '@fontsource/roboto-slab/700.css'
import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const isProjection = location.hash.startsWith('#/projection')
const isStage = location.hash.startsWith('#/stage')
// testes automáticos (só em desenvolvimento)
if (import.meta.env.DEV && !isProjection && !isStage) {
  Promise.all([import('./store'), import('./state/bible'), import('./state/msg')]).then(([a, b, m]) => {
    const w = window as unknown as Record<string, unknown>
    w.__avdp = a.useApp
    w.__avdpBible = b.useBible
    w.__avdpMsg = m.useMsg
  })
}
document.documentElement.classList.toggle('projection', isProjection || isStage)

// cada janela carrega só o que usa (o telão e o palco não trazem o operador inteiro). O módulo vem antes de
// desenhar: com React.lazy + Suspense o React 19 segura a troca do "carregando" por ~300 ms de propósito.
const root = createRoot(document.getElementById('root')!)
const load: Promise<ComponentType> = isProjection
  ? import('./components/Projection').then((m) => m.Projection)
  : isStage
    ? import('./components/Stage').then((m) => m.Stage)
    : import('./App').then((m) => m.default)
load.then((Window) =>
  root.render(
    <StrictMode>
      <Window />
    </StrictMode>,
  ),
)
