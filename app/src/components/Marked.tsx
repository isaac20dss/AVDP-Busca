import { splitMarked } from '../lib/slides'

/** Texto com ⟦termos⟧ destacados. */
export function Marked({ text }: { text: string }) {
  return (
    <>
      {splitMarked(text).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
    </>
  )
}

/**
 * Destaca palavras (já sem acento) num texto comum, do jeito que a busca achou:
 * `phrases` só marca a frase inteira (não as palavras soltas); `prefix` = começo de palavra vale
 * (falso quando "Palavra inteira" está ligada).
 */
export function Highlight({ text, terms, phrases = [], prefix = true }: { text: string; terms: string[]; phrases?: string[][]; prefix?: boolean }) {
  if (!terms.length && !phrases.length) return <>{text}</>
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const re = /[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu
  const parts = (text.match(re) ?? []).map((t) => ({ t, f: fold(t), word: /[\p{L}\p{N}]/u.test(t), hit: false }))
  const words = parts.map((p, i) => (p.word ? i : -1)).filter((i) => i >= 0)
  const inPhrase = new Set(phrases.flat())
  // frases: palavras seguidas, na ordem (a última pode ser começo de palavra)
  for (const ph of phrases.filter((p) => p.length)) {
    for (let w = 0; w + ph.length <= words.length; w++) {
      const ok = ph.every((x, k) => {
        const f = parts[words[w + k]].f
        return f === x || (prefix && k === ph.length - 1 && x.length >= 3 && f.startsWith(x))
      })
      if (ok) for (let i = words[w]; i <= words[w + ph.length - 1]; i++) parts[i].hit = true
    }
  }
  const singles = terms.map(fold).filter((t) => !inPhrase.has(t))
  const set = new Set(singles)
  for (const p of parts) {
    if (p.word && !p.hit && (set.has(p.f) || (prefix && singles.some((s) => s.length >= 3 && p.f.startsWith(s))))) p.hit = true
  }
  // junta pedaços vizinhos destacados: a frase vira um destaque só
  const runs: { t: string; hit: boolean }[] = []
  for (const p of parts) {
    const last = runs[runs.length - 1]
    if (last && last.hit === p.hit) last.t += p.t
    else runs.push({ t: p.t, hit: p.hit })
  }
  return <>{runs.map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}</>
}
