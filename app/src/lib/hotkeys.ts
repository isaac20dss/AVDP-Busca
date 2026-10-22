// Atalhos de teclado com os padrões do Holyrics (changelog oficial e API: F8 papel de parede,
// F9 slide sem texto, F10 tela preta, F5/Shift+F5 apresentação, Ctrl+F pesquisar,
// Ctrl+Shift+F pesquisa no livro, Ctrl+setas troca ao soltar o Ctrl, Ctrl+Shift+< > voltar/avançar,
// Ctrl+Z/Ctrl+Y na lista). Todos podem ser trocados em Configurações → Atalhos.

export type ActionId =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'cursorNext'
  | 'cursorPrev'
  | 'projectSelected'
  | 'projectFromStart'
  | 'wallpaper'
  | 'blank'
  | 'black'
  | 'exit'
  | 'searchPanel'
  | 'searchNarrow'
  | 'searchGlobal'
  | 'tabLetras'
  | 'tabBiblia'
  | 'tabMensagens'
  | 'tabTextos'
  | 'tabMidia'
  | 'toggleProjection'
  | 'historyBack'
  | 'historyForward'
  | 'playlistUndo'
  | 'playlistRedo'
  | 'playlistNext'
  | 'playlistPrev'
  | 'addToPlaylist'
  | 'editItem'
  | 'bibleNextVersion'
  | 'bibleVersion1'
  | 'bibleVersion2'
  | 'bibleVersion3'
  | 'toggleStage'
  | 'mediaPlayPause'
  | 'mediaStop'

export interface ActionDef {
  id: ActionId
  label: string
  group: 'Apresentação' | 'Tela' | 'Pesquisa' | 'Abas' | 'Lista' | 'Bíblia' | 'Mídia' | 'Geral'
  defaults: string[]
  /** Funciona mesmo com o cursor numa caixa de texto. */
  global?: boolean
}

export const ACTIONS: ActionDef[] = [
  { id: 'next', label: 'Próximo slide', group: 'Apresentação', defaults: ['ArrowRight', 'ArrowDown', 'PageDown'] },
  { id: 'prev', label: 'Slide anterior', group: 'Apresentação', defaults: ['ArrowLeft', 'ArrowUp', 'PageUp'] },
  { id: 'first', label: 'Primeiro slide', group: 'Apresentação', defaults: ['Home'] },
  { id: 'last', label: 'Último slide', group: 'Apresentação', defaults: ['End'] },
  { id: 'cursorNext', label: 'Escolher próximo (projeta ao soltar o Ctrl)', group: 'Apresentação', defaults: ['Ctrl+ArrowRight', 'Ctrl+ArrowDown'] },
  { id: 'cursorPrev', label: 'Escolher anterior (projeta ao soltar o Ctrl)', group: 'Apresentação', defaults: ['Ctrl+ArrowLeft', 'Ctrl+ArrowUp'] },
  { id: 'projectSelected', label: 'Projetar o slide selecionado', group: 'Apresentação', defaults: ['Enter', 'Shift+F5'] },
  { id: 'projectFromStart', label: 'Projetar do início', group: 'Apresentação', defaults: ['F5'], global: true },
  { id: 'wallpaper', label: 'Papel de parede (fundo sem texto / logo)', group: 'Tela', defaults: ['F8'], global: true },
  { id: 'blank', label: 'Slide sem texto (mantém o fundo)', group: 'Tela', defaults: ['F9'], global: true },
  { id: 'black', label: 'Tela preta', group: 'Tela', defaults: ['F10'], global: true },
  { id: 'exit', label: 'Parar de projetar (fecha a janela de projeção)', group: 'Tela', defaults: ['Escape'] },
  { id: 'toggleProjection', label: 'Abrir/fechar janela de projeção', group: 'Tela', defaults: ['Ctrl+Shift+P'], global: true },
  { id: 'toggleStage', label: 'Abrir/fechar a tela de palco (retorno)', group: 'Tela', defaults: ['Ctrl+Shift+O'], global: true },
  { id: 'searchPanel', label: 'Pesquisar no painel atual', group: 'Pesquisa', defaults: ['Ctrl+F'], global: true },
  { id: 'searchNarrow', label: 'Pesquisar no livro atual / dentro da mensagem aberta', group: 'Pesquisa', defaults: ['Ctrl+Shift+F'], global: true },
  { id: 'searchGlobal', label: 'Busca geral (músicas, Bíblia, mensagens)', group: 'Pesquisa', defaults: ['Ctrl+K'], global: true },
  { id: 'tabLetras', label: 'Aba Letras', group: 'Abas', defaults: ['Ctrl+1'], global: true },
  { id: 'tabBiblia', label: 'Aba Bíblia', group: 'Abas', defaults: ['Ctrl+2'], global: true },
  { id: 'tabMensagens', label: 'Aba Mensagens', group: 'Abas', defaults: ['Ctrl+3'], global: true },
  { id: 'tabTextos', label: 'Aba Textos', group: 'Abas', defaults: ['Ctrl+4'], global: true },
  { id: 'tabMidia', label: 'Aba Mídia', group: 'Abas', defaults: ['Ctrl+5'], global: true },
  { id: 'historyBack', label: 'Voltar ao item anterior', group: 'Geral', defaults: ['Ctrl+Shift+<', 'Alt+ArrowLeft'], global: true },
  { id: 'historyForward', label: 'Avançar', group: 'Geral', defaults: ['Ctrl+Shift+>', 'Alt+ArrowRight'], global: true },
  { id: 'editItem', label: 'Editar item aberto', group: 'Geral', defaults: ['F2'] },
  { id: 'addToPlaylist', label: 'Adicionar à lista de reprodução', group: 'Lista', defaults: ['Ctrl+Shift+L'], global: true },
  { id: 'playlistNext', label: 'Próximo item da lista', group: 'Lista', defaults: ['Ctrl+PageDown'], global: true },
  { id: 'playlistPrev', label: 'Item anterior da lista', group: 'Lista', defaults: ['Ctrl+PageUp'], global: true },
  { id: 'playlistUndo', label: 'Desfazer na lista', group: 'Lista', defaults: ['Ctrl+Z'] },
  { id: 'playlistRedo', label: 'Refazer na lista', group: 'Lista', defaults: ['Ctrl+Y'] },
  { id: 'bibleNextVersion', label: 'Trocar a versão da Bíblia (só as marcadas para o Ctrl+B)', group: 'Bíblia', defaults: ['Ctrl+B'], global: true },
  { id: 'bibleVersion1', label: '1ª versão do Ctrl+B', group: 'Bíblia', defaults: ['Ctrl+Alt+1'] },
  { id: 'bibleVersion2', label: '2ª versão do Ctrl+B', group: 'Bíblia', defaults: ['Ctrl+Alt+2'] },
  { id: 'bibleVersion3', label: '3ª versão do Ctrl+B', group: 'Bíblia', defaults: ['Ctrl+Alt+3'] },
  { id: 'mediaPlayPause', label: 'Mídia: tocar/pausar', group: 'Mídia', defaults: ['Ctrl+Space'], global: true },
  { id: 'mediaStop', label: 'Mídia: parar', group: 'Mídia', defaults: ['Ctrl+Shift+Space'], global: true },
]

export type HotkeyMap = Partial<Record<ActionId, string[]>>

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

/** "Ctrl+Shift+F", "F8", "ArrowRight", "Space"... a partir do evento. */
export function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent): string {
  if (MODIFIERS.has(e.key)) return ''
  let k = e.key === ' ' ? 'Space' : e.key
  if (k.length === 1) k = k.toUpperCase()
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean) as string[]
  return [...mods, k].join('+')
}

/** Combinações proibidas: letra, número ou símbolo sozinho (digitar não pode disparar ação). */
export function isBareCharacter(combo: string): boolean {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1).filter((m) => m !== 'Shift')
  return mods.length === 0 && key.length === 1
}

export function effectiveMap(custom: HotkeyMap | undefined): Map<string, ActionId> {
  const m = new Map<string, ActionId>()
  for (const a of ACTIONS) {
    for (const c of custom?.[a.id] ?? a.defaults) if (c) m.set(c, a.id)
  }
  return m
}

const PRETTY: Record<string, string> = {
  ArrowRight: '→',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageDown: 'PgDn',
  PageUp: 'PgUp',
  Escape: 'Esc',
  Enter: 'Enter',
  Space: 'Espaço',
  Delete: 'Del',
  Insert: 'Ins',
}

export function prettyCombo(c: string): string {
  return c
    .split('+')
    .map((p) => PRETTY[p] ?? p)
    .join(' + ')
}

export function keysFor(id: ActionId, custom: HotkeyMap | undefined): string[] {
  return custom?.[id] ?? ACTIONS.find((a) => a.id === id)?.defaults ?? []
}
