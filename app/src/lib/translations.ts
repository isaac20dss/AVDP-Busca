// Nomes das traduções das Mensagens. Os códigos vêm do banco local; os nomes, dos cabeçalhos
// ("Tradução: Crentes da Bíblia [Chapecó-SC]", "A Palavra Original [Goiânia-GO]") e da comparação de textos.
const CODES: Record<string, string> = {
  GVD: 'Gravações A Voz de Deus',
  GO: 'A Palavra Original · Tabernáculo da Fé (Goiânia-GO)',
  CB: 'Crentes da Bíblia (Chapecó-SC)',
  VSA: 'A Voz do Sétimo Anjo',
  EUA: 'Tradução feita nos EUA',
}

export function translationName(t: string): string {
  const code = t.trim()
  return CODES[code] ? `${code} · ${CODES[code]}` : code || 'sem nome'
}

const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** Semelhança (0..1) entre dois textos, por pares de palavras. */
export function textSimilarity(a: string, b: string): number {
  const pairs = (s: string) => {
    const w = words(s)
    const out = new Set<string>()
    for (let i = 0; i + 1 < w.length; i++) out.add(`${w[i]} ${w[i + 1]}`)
    return out
  }
  const A = pairs(a)
  const B = pairs(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  A.forEach((x) => B.has(x) && inter++)
  return inter / (A.size + B.size - inter)
}
