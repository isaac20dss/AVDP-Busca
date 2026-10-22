// Chamadas tipadas aos comandos Rust.
import { invoke } from '@tauri-apps/api/core'
import type {
  BibleInfo,
  BibleMeta,
  BookInfo,
  ChapterVerse,
  FilaReport,
  GroupInfo,
  GroupRow,
  MediaFile,
  HistoryItem,
  MonitorInfo,
  MsgResults,
  MsgSearch,
  MsgStats,
  Paragraph,
  Playlist,
  PlaylistItem,
  QueryOpts,
  Song,
  SongResults,
  Suggestions,
  TdfReport,
  BooksReport,
  HubEntry,
  HubItem,
  TextDoc,
  ThemeRow,
  VerseRef,
  VerseResults,
} from './types'

export const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const api = {
  appInfo: () => invoke<{ db_path: string; data_dir: string; version: string }>('app_info'),
  getSettings: () => invoke<Record<string, string>>('get_settings'),
  setSetting: (key: string, value: string) => invoke<void>('set_setting', { key, value }),

  songsSearch: (query: string, opts: QueryOpts, sort = '') => invoke<SongResults>('songs_search', { query, opts, sort }),
  songGet: (id: number) => invoke<Song>('song_get', { id }),
  songSave: (song: Song) => invoke<number>('song_save', { song }),
  songDelete: (id: number) => invoke<void>('song_delete', { id }),
  songPlayed: (id: number) => invoke<void>('song_played', { id }),
  songsImport: (songs: Partial<Song>[], onDuplicate: 'skip' | 'replace' | 'keep') =>
    invoke<{ added: number; updated: number; skipped: number }>('songs_import', { songs, onDuplicate }),

  textsList: (query: string) => invoke<TextDoc[]>('texts_list', { query }),
  textGet: (id: number) => invoke<TextDoc>('text_get', { id }),
  textSave: (doc: TextDoc) => invoke<number>('text_save', { doc }),
  textDelete: (id: number) => invoke<void>('text_delete', { id }),

  bibleBooks: () => invoke<BookInfo[]>('bible_books'),
  bibleList: () => invoke<BibleInfo[]>('bible_list'),
  bibleChapter: (bibles: string[], book: number, chapter: number) => invoke<ChapterVerse[]>('bible_chapter', { bibles, book, chapter }),
  bibleChapterCounts: (bible: string) => invoke<number[]>('bible_chapter_counts', { bible }),
  bibleParseRef: (input: string) => invoke<VerseRef | null>('bible_parse_ref', { input }),
  bibleSearch: (q: { query: string; opts: QueryOpts; bible: string; scope: string; book: number; limit?: number; offset?: number; sort?: string }) =>
    invoke<VerseResults>('bible_search', { q }),
  bibleImportVerses: (meta: BibleMeta, verses: [number, number, number, string][]) => invoke<number>('bible_import_verses', { meta, verses }),
  bibleImportMyBible: (path: string, meta: BibleMeta) => invoke<number>('bible_import_mybible', { path, meta }),
  bibleScanEasySlides: () =>
    invoke<{ path: string; abbrev: string; name: string; license: string; language: string }[]>('bible_scan_easyslides'),
  bibleDownloadEbible: (meta: BibleMeta) => invoke<number>('bible_download_ebible', { meta }),
  bibleDelete: (id: string) => invoke<void>('bible_delete', { id }),

  msgStats: () => invoke<MsgStats>('msg_stats'),
  msgList: (q: { filter?: string; year_from?: number | null; year_to?: number | null; only_with_text?: boolean; only_multi?: boolean; sort?: string; limit?: number; offset?: number; collection?: string }) =>
    invoke<{ total: number; rows: GroupRow[] }>('msg_list', { q }),
  msgGroup: (id: number) => invoke<GroupInfo>('msg_group', { id }),
  msgParagraphs: (variantId: number) => invoke<Paragraph[]>('msg_paragraphs', { variantId }),
  msgSetPreferred: (groupId: number, variantId: number) => invoke<void>('msg_set_preferred', { groupId, variantId }),
  msgSearch: (q: MsgSearch) => invoke<MsgResults>('msg_search', { q }),
  msgSuggest: (input: string) => invoke<Suggestions>('msg_suggest', { input }),
  msgDefaultLocalPath: () => invoke<string | null>('msg_default_local_path'),
  msgImportLocal: (path: string) => invoke<{ read: number; with_text: number; paragraphs: number; groups: number }>('msg_import_local', { path }),
  msgSyncCbb: () => invoke<number>('msg_sync_cbb'),
  msgSyncTdf: () => invoke<TdfReport>('msg_sync_tdf'),
  msgParaSave: (variantId: number, seq: number, text: string) => invoke<void>('msg_para_save', { variantId, seq, text }),
  msgParaJoin: (variantId: number, seq: number) => invoke<boolean>('msg_para_join', { variantId, seq }),
  msgEditsUndo: (variantId: number) => invoke<boolean>('msg_edits_undo', { variantId }),
  msgImportBooks: (path: string) => invoke<BooksReport>('msg_import_books', { path }),
  hubList: () => invoke<HubEntry[]>('hub_list'),
  hubPdf: (tmId: number) => invoke<ArrayBuffer>('hub_pdf', { tmId }),
  hubSave: (item: HubItem, text: string) => invoke<number>('hub_save', { item, text }),
  hubFinish: () => invoke<number>('hub_finish'),

  historyAdd: (scope: string, query: string, opts: string, hits: number) => invoke<void>('history_add', { scope, query, opts, hits }),
  historyList: (scope: string) => invoke<HistoryItem[]>('history_list', { scope }),
  historyClear: (scope: string) => invoke<void>('history_clear', { scope }),

  themesList: () => invoke<ThemeRow[]>('themes_list'),
  themeSave: (theme: ThemeRow) => invoke<number>('theme_save', { theme }),
  themeDelete: (id: number) => invoke<void>('theme_delete', { id }),
  themeStoreImage: (path: string) => invoke<string>('theme_store_image', { path }),

  playlistsList: () => invoke<Playlist[]>('playlists_list'),
  playlistCreate: (name: string) => invoke<number>('playlist_create', { name }),
  playlistRename: (id: number, name: string) => invoke<void>('playlist_rename', { id, name }),
  playlistDelete: (id: number) => invoke<void>('playlist_delete', { id }),
  playlistItems: (id: number) => invoke<PlaylistItem[]>('playlist_items', { id }),
  playlistSetItems: (id: number, items: PlaylistItem[]) => invoke<void>('playlist_set_items', { id, items }),
  filaExport: (playlistId: number, path: string) => invoke<number>('fila_export', { playlistId, path }),
  filaImport: (path: string) => invoke<FilaReport>('fila_import', { path }),

  holyricsVersions: () => invoke<unknown>('holyrics_versions'),
  holyricsShowVerse: (ids: string[], version?: string) => invoke<void>('holyrics_show_verse', { ids, version: version ?? null }),
  holyricsShowSlides: (slides: string[]) => invoke<void>('holyrics_show_slides', { slides }),
  holyricsCall: (action: string, body: Record<string, unknown>) => invoke<unknown>('holyrics_call', { action, body }),

  mediaList: (kind: '' | 'image' | 'video' | 'audio', query: string) => invoke<MediaFile[]>('media_list', { kind, query }),
  mediaAdd: (paths: string[]) => invoke<number>('media_add', { paths }),
  mediaRemove: (id: number) => invoke<void>('media_remove', { id }),
  allowFile: (path: string) => invoke<void>('allow_file', { path }),

  monitorsList: () => invoke<MonitorInfo[]>('monitors_list'),
  projectionOpen: (monitor: number | null) => invoke<void>('projection_open', { monitor }),
  projectionClose: () => invoke<void>('projection_close'),
  stageOpen: (monitor: number | null) => invoke<void>('stage_open', { monitor }),
  stageClose: () => invoke<void>('stage_close'),
}

export const errText = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : JSON.stringify(e))
