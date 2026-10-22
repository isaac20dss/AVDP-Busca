// Modos e opções de busca (iguais para músicas, Bíblia e mensagens).
import type { Mode, QueryOpts } from '../types'

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'all', label: 'Todas', hint: 'Todas as palavras, em qualquer ordem' },
  { id: 'exact', label: 'Frase exata', hint: 'As palavras juntas, nesta ordem' },
  { id: 'near', label: 'Próximas', hint: 'Palavras perto umas das outras' },
  { id: 'any', label: 'Qualquer', hint: 'Pelo menos uma das palavras' },
]

export function ModeSwitch({ opts, onChange }: { opts: QueryOpts; onChange: (o: QueryOpts) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Modo de busca">
      {MODES.map((m) => (
        <button key={m.id} role="radio" aria-checked={opts.mode === m.id} className={opts.mode === m.id ? 'on' : ''} title={m.hint} onClick={() => onChange({ ...opts, mode: m.id })}>
          {m.label}
        </button>
      ))}
    </div>
  )
}

export function OptionChecks({ opts, onChange, compact }: { opts: QueryOpts; onChange: (o: QueryOpts) => void; compact?: boolean }) {
  return (
    <div className={`checks${compact ? ' compact' : ''}`}>
      <label title="Sem isto, 'amor' também acha 'amoroso' (começo da palavra)">
        <input type="checkbox" checked={opts.whole_word} onChange={(e) => onChange({ ...opts, whole_word: e.target.checked })} /> Palavra inteira
      </label>
      <label title="Inclui outras formas da palavra: amor, amores, amar, amou…">
        <input type="checkbox" checked={opts.variants} onChange={(e) => onChange({ ...opts, variants: e.target.checked })} /> Variações
      </label>
      <label title="Acha mesmo com erro de digitação">
        <input type="checkbox" checked={opts.fuzzy} onChange={(e) => onChange({ ...opts, fuzzy: e.target.checked })} /> Aproximada
      </label>
      {opts.mode === 'near' && (
        <label title="Distância máxima entre as palavras">
          até
          <input type="number" min={1} max={60} value={opts.near} onChange={(e) => onChange({ ...opts, near: Math.max(1, +e.target.value || 1) })} />
          palavras
        </label>
      )}
    </div>
  )
}

export const SYNTAX_HELP =
  'Dicas: "frase exata" • "anjo luz"~5 (perto) • -excluir • a OU b • a XOR b • (a OU b) c • começo* • pro?eta • parecida~ • graça^3 (peso) • titulo:graça • 65-1127B'
