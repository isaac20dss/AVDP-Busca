// Onde está a palavra procurada dentro do parágrafo (mesmas regras do destaque do leitor) e em que
// pedaço (slide) do parágrafo ela cai — para a pesquisa levar à palavra, não só ao parágrafo.

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Posição (no texto original) da primeira palavra que o leitor destacaria: frases inteiras em `phrases`,
 * palavras soltas em `terms`; `prefix` = começo de palavra vale. -1 = nenhuma.
 */
export function firstHit(text: string, terms: string[], phrases: string[][] = [], prefix = true): number {
  if (!terms.length && !phrases.length) return -1
  const parts = text.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu) ?? []
  const offs: number[] = []
  let o = 0
  for (const p of parts) {
    offs.push(o)
    o += p.length
  }
  const f = parts.map(fold)
  const words = parts.map((p, i) => (/[\p{L}\p{N}]/u.test(p) ? i : -1)).filter((i) => i >= 0)
  let best = Infinity
  const inPhrase = new Set(phrases.flat())
  for (const ph of phrases.filter((p) => p.length)) {
    for (let w = 0; w + ph.length <= words.length; w++) {
      const ok = ph.every((x, k) => {
        const g = f[words[w + k]]
        return g === x || (prefix && k === ph.length - 1 && x.length >= 3 && g.startsWith(x))
      })
      if (ok) {
        best = Math.min(best, offs[words[w]])
        break
      }
    }
  }
  const singles = terms.map(fold).filter((t) => !inPhrase.has(t))
  const set = new Set(singles)
  for (const i of words) {
    if (set.has(f[i]) || (prefix && singles.some((s) => s.length >= 3 && f[i].startsWith(s)))) {
      best = Math.min(best, offs[i])
      break
    }
  }
  return best === Infinity ? -1 : best
}

/** Pedaço do `chunkText` (índice em `parts`) onde fica a posição `offset` do texto original. */
export function chunkIndexAt(text: string, parts: string[], offset: number): number {
  if (parts.length < 2 || offset <= 0) return 0
  const before = text.slice(0, offset).replace(/\s+/g, ' ').trimStart().length
  const norm = text.replace(/\s+/g, ' ').trim()
  let from = 0
  for (let k = 0; k < parts.length; k++) {
    const at = norm.indexOf(parts[k], from)
    const end = (at >= 0 ? at : from) + parts[k].length
    if (before < end) return k
    from = end
  }
  return parts.length - 1
}
