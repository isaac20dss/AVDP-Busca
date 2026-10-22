// Tipos compartilhados entre o front e os comandos Rust.

export type Mode = 'all' | 'any' | 'exact' | 'near'

export interface QueryOpts {
  mode: Mode
  whole_word: boolean
  variants: boolean
  fuzzy: boolean
  near: number
}

export const defaultOpts = (over: Partial<QueryOpts> = {}): QueryOpts => ({
  mode: 'all',
  whole_word: false,
  variants: false,
  fuzzy: false,
  near: 10,
  ...over,
})

export interface Song {
  id: number
  title: string
  artist: string
  author: string
  note: string
  lyrics: string
  paragraph_order: string
  copyright: string
  source: string
  theme_id: number | null
  play_count: number
}

export const emptySong = (): Song => ({
  id: 0,
  title: '',
  artist: '',
  author: '',
  note: '',
  lyrics: '',
  paragraph_order: '',
  copyright: '',
  source: '',
  theme_id: null,
  play_count: 0,
})

export interface SongHit {
  id: number
  title: string
  artist: string
  marked: string
  matched: '' | 'title' | 'artist' | 'lyrics'
  play_count: number
}

export interface SongResults {
  hits: SongHit[]
  total: number
  terms: string[]
  approximate: boolean
}

export interface TextDoc {
  id: number
  title: string
  body: string
  source: string
}

export interface BookInfo {
  id: number
  abbrev: string
  name: string
  name_en: string
  chapters: number
  group: string
}

export interface BibleInfo {
  id: string
  name: string
  abbrev: string
  language: string
  license: string
  source: string
  verses: number
}

export interface ChapterVerse {
  verse: number
  texts: (string | null)[]
}

export interface VerseRef {
  book: number
  chapter: number
  verse: number | null
  verse_end: number | null
}

export interface VerseHit {
  book: number
  chapter: number
  verse: number
  reference: string
  text: string
  marked: string
}

export interface VerseResults {
  total: number
  hits: VerseHit[]
  terms: string[]
  reference: VerseRef | null
}

export interface BibleMeta {
  id: string
  name: string
  abbrev: string
  language?: string
  license?: string
  source?: string
}

export interface MsgStats {
  groups: number
  variants: number
  with_text: number
  multi: number
  paragraphs: number
  by_source: [string, number][]
  translations: [string, number][]
  /** Cópias antigas escondidas: mesmo texto que o Tabernáculo da Fé traz revisado. */
  superseded: number
  year_min: number | null
  year_max: number | null
}

/** Resultado de importar uma fila (`.avdpfila`) vinda de outro computador. */
export interface FilaReport {
  playlist_id: number
  name: string
  items: number
  updated: boolean
  songs_new: number
  songs_updated: number
  texts_new: number
  texts_updated: number
  messages_downloaded: number
  messages_from_file: number
  missing: string[]
}

/** Importação do zip/pasta de TXT: livro das Eras e série dos Selos. */
export interface BooksReport {
  eras_chapters: number
  eras_paragraphs: number
  selos_same: number
  selos_new: number
  ignored: string[]
}

/** Mensagem do MessageHub (Português-B). */
export interface HubItem {
  tm_id: number
  code: string
  title: string
  title_en: string
  local: string
  updated: string
}
export interface HubEntry extends HubItem {
  need: boolean
}

export interface TdfReport {
  total: number
  downloaded: number
  superseded: number
}

export interface GroupRow {
  id: number
  code: string
  date_key: string
  title: string
  local: string
  translations: string
  variant_count: number
  with_text: number
  chosen: boolean
}

export interface VariantInfo {
  id: number
  /** Texto corrigido pelo operador (a sincronização não troca). */
  edited?: boolean
  source: string
  /** Cópia antiga escondida: id da revisão do Tabernáculo da Fé que a substitui. */
  superseded_by: number | null
  translation: string
  title: string
  local: string
  para_count: number
  pdf_url: string
  audio_url: string
  page_url: string
}

export interface GroupInfo {
  id: number
  code: string
  date_key: string
  year: number
  title: string
  local: string
  preferred_variant: number | null
  chosen: boolean
  variants: VariantInfo[]
}

export interface Paragraph {
  id: number
  num: number
  seq: number
  text: string
}

export interface MsgHit {
  paragraph_id: number
  num: number
  seq: number
  group_id: number
  variant_id: number
  code: string
  date_key: string
  title: string
  local: string
  translation: string
  source: string
  marked: string
  hits: number
}

export interface Suggestions {
  terms: { word: string; count: number }[]
  titles: GroupRow[]
  /** Continuação de frase ("sete se" -> "sete selos"). */
  pairs: { word: string; phrase: string; count: number }[]
}

export interface MsgResults {
  total: number
  hits: MsgHit[]
  terms: string[]
  direct: GroupRow[]
}

export interface MsgSearch {
  query: string
  opts: QueryOpts
  year_from: number | null
  year_to: number | null
  local: string
  translations: string[]
  sources: string[]
  only_preferred: boolean
  sort: 'relevance' | 'date' | 'title' | 'local'
  by_message: boolean
  limit: number
  offset: number
}

export interface HistoryItem {
  id: number
  scope: string
  query: string
  opts: string
  hits: number
  at: number
}

export interface Playlist {
  id: number
  name: string
  created_at: number
  items: number
}

export interface PlaylistItem {
  kind: ItemKind
  ref: string
  label: string
}

export interface ThemeRow {
  id: number
  name: string
  data: string
}

export interface ThemeData {
  bg: { kind: 'color' | 'gradient' | 'image'; color?: string; gradient?: string; image?: string; dim?: number }
  font: string
  size: number
  color: string
  bold: boolean
  italic: boolean
  uppercase: boolean
  align: 'left' | 'center' | 'right' | 'justify'
  valign: 'top' | 'middle' | 'bottom'
  lineHeight: number
  shadow: boolean
  outline: number
  outlineColor: string
  padding: number
  /** Margens separadas (% da altura). Sem valor: `padding` em cima/embaixo e `padding × 1,2` nas laterais. */
  paddingTop?: number
  paddingBottom?: number
  paddingSide?: number
  /** Pedaço de parágrafo com menos caracteres que isto vai junto com o vizinho (sem valor: automático, pelo tamanho da letra). */
  mergeChars?: number
  band?: boolean
  footer: { show: boolean; size: number; color: string }
}

export interface MonitorInfo {
  index: number
  name: string
  width: number
  height: number
  x: number
  y: number
  primary: boolean
}

// ---------- apresentação ----------

export type ItemKind = 'song' | 'verse' | 'message' | 'text' | 'media'

export interface Slide {
  text: string
  /** Rodapé na tela (referência, título da música, §parágrafo). */
  footer?: string
  /** Etiqueta no operador ("Refrão", "v. 16", "§12"). */
  label?: string
  /** Slide de título (música). */
  title?: boolean
  /** Texto de outra(s) versão(ões), mostrado abaixo em letra menor. */
  alt?: string
  /** Referência do versículo (para mandar ao Holyrics). */
  ref?: { book: number; chapter: number; verse: number }
  /** Vários versículos no mesmo slide (trecho projetado junto). */
  refs?: { book: number; chapter: number; verse: number }[]
  /** Referência por extenso sem a versão ("João 3:16"), para "só a referência". */
  refText?: string
  /** Começo do próximo versículo, em letra menor (opção). */
  peek?: string
  /** Imagem ou vídeo em tela cheia. */
  media?: MediaRef
}

export interface MediaRef {
  type: 'image' | 'video' | 'audio'
  path: string
  name: string
  loop?: boolean
  fit?: 'contain' | 'cover'
}

export interface MediaFile {
  id: number
  path: string
  name: string
  kind: 'image' | 'video' | 'audio'
  folder: string
  size: number
  exists: boolean
}

export interface Item {
  kind: ItemKind
  /** Chave única (ex.: "song:12", "verse:kjv:43:3", "message:55:812"). */
  key: string
  title: string
  subtitle?: string
  slides: Slide[]
  themeId?: number | null
  /** Anotação do item (música), mostrada na tela de palco. */
  note?: string
  /** Dados para recarregar o item da lista de reprodução. */
  ref: Record<string, unknown>
}

export type Blank = 'none' | 'black' | 'clear' | 'logo'

export interface LivePayload {
  /** Muda a cada projeção (o vídeo reinicia quando muda). */
  seq: number
  slide: Slide | null
  theme: ThemeData
  blank: Blank
  logoText: string
  fadeMs: number
}

/** O que a tela de palco/retorno mostra. */
export interface StagePayload {
  slide: Slide | null
  next: Slide | null
  title: string
  label: string
  position: string
  blank: Blank
  note: string
}
