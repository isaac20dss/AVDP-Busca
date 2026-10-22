// Configurações: projeção, slides, Bíblias, fontes de mensagens, Holyrics, sobre.
import { listen } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { api, errText } from '../api'
import { EBIBLE_VERSIONS, makeBookResolver, parseBibleText } from '../lib/bibleImport'
import { ACTIONS, comboFromEvent, effectiveMap, isBareCharacter, keysFor, prettyCombo, type ActionId } from '../lib/hotkeys'
import { chunkFor } from '../lib/fit'
import { DEFAULT_MSG_FOOTER, msgFooter } from '../lib/slides'
import { syncHub, useHubSync } from '../lib/hubSync'
import { cycleVersions, useBible } from '../state/bible'
import { useApp } from '../store'
import type { MonitorInfo, MsgStats } from '../types'
import { Modal } from './Modal'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

const TABS = [
  ['projecao', 'Projeção'],
  ['biblias', 'Bíblias'],
  ['mensagens', 'Mensagens'],
  ['atalhos', 'Atalhos'],
  ['holyrics', 'Holyrics'],
  ['sobre', 'Sobre'],
] as const

export function SettingsDialog({ initialTab }: { initialTab?: string }) {
  const setModal = useApp((s) => s.setModal)
  const [tab, setTab] = useState(initialTab ?? 'projecao')
  return (
    <Modal title="Configurações" onClose={() => setModal(null)} wide>
      <div className="settings">
        <nav className="settings-nav">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {tab === 'projecao' && <ProjectionTab />}
          {tab === 'biblias' && <BiblesTab />}
          {tab === 'mensagens' && <MessagesTab />}
          {tab === 'atalhos' && <HotkeysTab />}
          {tab === 'holyrics' && <HolyricsTab />}
          {tab === 'sobre' && <AboutTab />}
        </div>
      </div>
    </Modal>
  )
}

function ProjectionTab() {
  const { settings, saveSettings, projectionOpen, setProjectionOpen, stageOpen, setStageOpen, fail } = useApp(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings, projectionOpen: s.projectionOpen, setProjectionOpen: s.setProjectionOpen, stageOpen: s.stageOpen, setStageOpen: s.setStageOpen, fail: s.fail })))
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  useEffect(() => {
    api.monitorsList().then(setMonitors).catch(fail)
  }, [fail])
  const slide = settings.slide
  return (
    <div className="form">
      <h3>Tela do público</h3>
      <div className="monitors">
        <button className={`monitor${settings.monitor == null ? ' on' : ''}`} onClick={() => saveSettings({ monitor: null })}>
          <Icon name="monitor" size={22} />
          <b>Em janela</b>
          <small>para testar ou usar com OBS</small>
        </button>
        {monitors.map((m) => (
          <button key={m.index} className={`monitor${settings.monitor === m.index ? ' on' : ''}`} onClick={() => saveSettings({ monitor: m.index })}>
            <Icon name="monitor" size={22} />
            <b>
              {m.primary ? 'Principal' : `Monitor ${m.index + 1}`} {m.width}×{m.height}
            </b>
            <small>{m.name.replace(/^\\\\\.\\/, '')}</small>
          </button>
        ))}
      </div>
      <button
        className="primary"
        onClick={async () => {
          try {
            await api.projectionOpen(settings.monitor)
            setProjectionOpen(true)
          } catch (e) {
            fail(e)
          }
        }}
      >
        <Icon name="monitor" /> {projectionOpen ? 'Mover projeção para cá' : 'Abrir projeção'}
      </button>
      <h3>Slides</h3>
      <label className="frow">
        <input type="checkbox" checked={slide.titleSlide} onChange={(e) => saveSettings({ slide: { ...slide, titleSlide: e.target.checked } })} />
        Primeiro slide da música com título e artista
      </label>
      <label className="frow">
        Máximo de linhas por slide nas letras
        <input type="number" min={0} max={12} value={slide.maxLines} onChange={(e) => saveSettings({ slide: { ...slide, maxLines: Math.max(0, +e.target.value) } })} />
        <small className="hint">0 = estrofe inteira</small>
      </label>
      <label className="frow">
        <input type="checkbox" checked={slide.autoChunk} onChange={(e) => saveSettings({ slide: { ...slide, autoChunk: e.target.checked } })} />
        Dividir mensagens e textos pelo tamanho da letra do tema
        <small className="hint">
          {slide.autoChunk ? `agora: até ${chunkFor('message')} caracteres por slide nas mensagens (letra maior = menos texto por slide)` : 'desligado: usa o número abaixo'}
        </small>
      </label>
      <label className="frow">
        Caracteres por slide (sem a divisão automática)
        <input
          type="number"
          min={40}
          max={1200}
          step={20}
          value={slide.chunkChars}
          disabled={slide.autoChunk}
          onChange={(e) => saveSettings({ slide: { ...slide, chunkChars: Math.max(40, +e.target.value) } })}
        />
      </label>
      <FooterEditor />
      <label className="frow">
        <input type="checkbox" checked={settings.showSongFooter} onChange={(e) => saveSettings({ showSongFooter: e.target.checked })} />
        Mostrar rodapé nas letras
      </label>
      <label className="frow">
        Transição (fade)
        <input type="number" min={0} max={2000} step={50} value={settings.fadeMs} onChange={(e) => saveSettings({ fadeMs: Math.max(0, +e.target.value) })} /> ms
      </label>
      <h3>Bíblia</h3>
      <div className="frow">
        Trecho (ex.: 1co 13:4-7, ou Ctrl/Shift+clique nos versículos)
        <label className="chip-check">
          <input type="radio" checked={settings.bibleRangeMode === 'sequencia'} onChange={() => saveSettings({ bibleRangeMode: 'sequencia' })} /> um versículo por slide
        </label>
        <label className="chip-check">
          <input type="radio" checked={settings.bibleRangeMode === 'juntos'} onChange={() => saveSettings({ bibleRangeMode: 'juntos' })} /> todos juntos
        </label>
      </div>
      <label className="frow">
        <input type="checkbox" checked={settings.bibleSplitLong} onChange={(e) => saveSettings({ bibleSplitLong: e.target.checked })} />
        Dividir versículo longo em mais de um slide (usa o limite de caracteres acima)
      </label>
      <label className="frow">
        <input type="checkbox" checked={settings.bibleShowNextStart} onChange={(e) => saveSettings({ bibleShowNextStart: e.target.checked })} />
        Mostrar o começo do próximo versículo em letra menor
      </label>
      <label className="frow">
        <input type="checkbox" checked={settings.bibleOnlyRef} onChange={(e) => saveSettings({ bibleOnlyRef: e.target.checked })} />
        Projetar só a referência (ex.: João 3:16), sem o texto
      </label>
      <h3>Tela de palco (retorno)</h3>
      <p className="hint">Para quem está na frente: slide no ar, o próximo, a anotação da música e o relógio. Atalho: {prettyCombo(keysFor('toggleStage', settings.hotkeys)[0] ?? '')}.</p>
      <div className="monitors">
        <button className={`monitor${settings.stageMonitor == null ? ' on' : ''}`} onClick={() => saveSettings({ stageMonitor: null })}>
          <Icon name="monitor" size={22} />
          <b>Em janela</b>
          <small>pode arrastar para outro monitor</small>
        </button>
        {monitors.map((m) => (
          <button key={m.index} className={`monitor${settings.stageMonitor === m.index ? ' on' : ''}`} onClick={() => saveSettings({ stageMonitor: m.index })}>
            <Icon name="monitor" size={22} />
            <b>
              {m.primary ? 'Principal' : `Monitor ${m.index + 1}`} {m.width}×{m.height}
            </b>
            <small>
              {m.name.replace(/^\\\\\.\\/, '')}
              {settings.monitor === m.index ? ' · é a tela do público' : ''}
            </small>
          </button>
        ))}
      </div>
      <button
        onClick={async () => {
          try {
            if (stageOpen) {
              await api.stageClose()
              setStageOpen(false)
            } else {
              await api.stageOpen(settings.stageMonitor)
              setStageOpen(true)
            }
          } catch (e) {
            fail(e)
          }
        }}
      >
        <Icon name="monitor" /> {stageOpen ? 'Fechar tela de palco' : 'Abrir tela de palco'}
      </button>
      <h3>Papel de parede (F8)</h3>
      <div className="row-buttons">
        <button
          onClick={async () => {
            const p = await openDialog({ multiple: false, filters: [{ name: 'Imagem', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] })
            if (!p || Array.isArray(p)) return
            saveSettings({ wallpaperImage: await api.themeStoreImage(String(p)) })
          }}
        >
          <Icon name="image" /> Escolher imagem
        </button>
        {settings.wallpaperImage && (
          <>
            <span className="hint">{settings.wallpaperImage.split(/[\\/]/).pop()}</span>
            <button onClick={() => saveSettings({ wallpaperImage: '' })}>Usar o fundo do tema</button>
          </>
        )}
      </div>
      <label className="frow">
        Texto sobre o papel de parede
        <input value={settings.logoText} onChange={(e) => saveSettings({ logoText: e.target.value })} placeholder="ex.: A Voz do Profeta" />
      </label>
      <label className="frow">
        <input type="checkbox" checked={settings.autoOpenProjection} onChange={(e) => saveSettings({ autoOpenProjection: e.target.checked })} />
        Abrir a janela de projeção sozinha ao projetar
      </label>
    </div>
  )
}

function BiblesTab() {
  const { bibles, books, loadBibles, toast, fail, settings, saveSettings } = useApp(useShallow((s) => ({ bibles: s.bibles, books: s.books, loadBibles: s.loadBibles, toast: s.toast, fail: s.fail, settings: s.settings, saveSettings: s.saveSettings })))
  // versões do Ctrl+B: as marcadas aqui; sem nenhuma marcada, as completas na língua da principal
  const cycle = cycleVersions().map((b) => b.id)
  const toggleCycle = (id: string) => {
    const base = settings.bibleCycle.length ? settings.bibleCycle : cycle
    saveSettings({ bibleCycle: base.includes(id) ? base.filter((x) => x !== id) : [...base, id] })
  }
  const [busy, setBusy] = useState('')
  const [found, setFound] = useState<{ path: string; abbrev: string; name: string; license: string; language: string }[]>([])
  const [meta, setMeta] = useState({ name: '', abbrev: '', license: '' })

  useEffect(() => {
    api.bibleScanEasySlides().then(setFound).catch(() => {})
  }, [])

  const after = async (n: number, what: string) => {
    toast(`${what}: ${n.toLocaleString('pt-BR')} versículos`, 'ok')
    await loadBibles()
    useBible.getState().load()
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  const idFrom = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `biblia-${Date.now()}`

  const importTextFile = async (file: File) =>
    run(`Lendo ${file.name}…`, async () => {
      const parsed = parseBibleText(await file.text(), makeBookResolver(books))
      if (!parsed.verses.length) throw new Error(`Formato não reconhecido (${parsed.format}).`)
      const abbrev = meta.abbrev || file.name.replace(/\.[^.]+$/, '').slice(0, 10).toUpperCase()
      const name = meta.name || parsed.name || abbrev
      const n = await api.bibleImportVerses({ id: idFrom(abbrev), name, abbrev, license: meta.license, source: file.name, language: 'pt' }, parsed.verses)
      await after(n, `${abbrev} (${parsed.format})`)
    })

  const importSqlite = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: 'Bíblia SQLite (MyBible/EasySlides)', extensions: ['sqlite3', 'SQLite3', 'mybible', 'db', 'sqlite'] }] })
    if (!path || Array.isArray(path)) return
    const file = String(path).split(/[\\/]/).pop() ?? 'biblia'
    const abbrev = meta.abbrev || file.split('.')[0].toUpperCase()
    run(`Importando ${file}…`, async () => {
      const n = await api.bibleImportMyBible(String(path), { id: idFrom(abbrev), name: meta.name, abbrev, license: meta.license, source: file, language: 'pt' })
      await after(n, abbrev)
    })
  }

  return (
    <div className="form">
      <h3>Instaladas</h3>
      <table className="table">
        <tbody>
          {bibles.map((b) => (
            <tr key={b.id}>
              <td>
                <b>{b.abbrev}</b>
              </td>
              <td>{b.name}</td>
              <td className="muted">{b.verses.toLocaleString('pt-BR')} vers.</td>
              <td className="muted small">{b.license}</td>
              <td>
                <label className="chip-check" title="Entra na troca com Ctrl+B (e em Ctrl+Alt+1/2/3, nesta ordem)">
                  <input type="checkbox" checked={cycle.includes(b.id)} onChange={() => toggleCycle(b.id)} /> Ctrl+B
                  {cycle.includes(b.id) && cycle.indexOf(b.id) < 3 ? ` (${cycle.indexOf(b.id) + 1})` : ''}
                </label>
              </td>
              <td>
                <button
                  className="icon-btn danger"
                  title="Remover"
                  onClick={async () => (await confirm(`Remover ${b.abbrev}?`)) && run('Removendo…', async () => (await api.bibleDelete(b.id), await loadBibles()))}
                >
                  <Icon name="trash" />
                </button>
              </td>
            </tr>
          ))}
          {!bibles.length && (
            <tr>
              <td className="muted">Nenhuma ainda.</td>
            </tr>
          )}
        </tbody>
      </table>
      {busy && <div className="banner">{busy}</div>}

      <h3>Versões livres (download do eBible.org)</h3>
      <p className="hint">
        As Bíblias do Holyrics (ACF, NVI, NAA…) são licenciadas e ficam cifradas dentro dele; para projetá-las use o botão <b>Holyrics</b> na aba Bíblia
        (configure a API ao lado). Aqui ficam versões de uso livre.
      </p>
      <table className="table">
        <tbody>
          {EBIBLE_VERSIONS.map((v) => {
            const installed = bibles.some((b) => b.id === v.id)
            return (
              <tr key={v.id}>
                <td>
                  <b>{v.abbrev}</b>
                </td>
                <td>{v.name}</td>
                <td className="muted small">{v.license}</td>
                <td>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      run(`Baixando ${v.abbrev}…`, async () => {
                        const n = await api.bibleDownloadEbible({ id: v.id, name: v.name, abbrev: v.abbrev, license: v.license, language: v.language, source: 'eBible.org' })
                        await after(n, v.abbrev)
                      })
                    }
                  >
                    {installed ? 'Baixar de novo' : 'Baixar'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {found.length > 0 && (
        <>
          <h3>Encontradas no EasySlides deste PC</h3>
          <table className="table">
            <tbody>
              {found.map((f) => (
                <tr key={f.path}>
                  <td>
                    <b>{f.abbrev}</b>
                  </td>
                  <td>{f.name}</td>
                  <td className="muted small">{f.license}</td>
                  <td>
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        run(`Importando ${f.abbrev}…`, async () => {
                          const n = await api.bibleImportMyBible(f.path, {
                            id: idFrom(f.abbrev),
                            name: f.name,
                            abbrev: f.abbrev,
                            license: f.license,
                            source: 'EasySlides',
                            language: /english/i.test(f.language) ? 'en' : /chinese/i.test(f.language) ? 'zh' : 'pt',
                          })
                          await after(n, f.abbrev)
                        })
                      }
                    >
                      Importar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Importar arquivo</h3>
      <div className="row3">
        <input placeholder="Sigla (ex.: ARC1911)" value={meta.abbrev} onChange={(e) => setMeta({ ...meta, abbrev: e.target.value })} />
        <input placeholder="Nome da versão" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
        <input placeholder="Licença / origem" value={meta.license} onChange={(e) => setMeta({ ...meta, license: e.target.value })} />
      </div>
      <div className="row-buttons">
        <label className="button">
          <Icon name="upload" /> Zefania / OSIS / USFX XML, JSON, CSV, VPL…
          <input type="file" hidden accept=".xml,.json,.csv,.tsv,.txt,.osis,.usfx" onChange={(e) => e.target.files?.[0] && importTextFile(e.target.files[0])} />
        </label>
        <button onClick={importSqlite}>
          <Icon name="upload" /> SQLite (MyBible / EasySlides)
        </button>
      </div>
    </div>
  )
}

/** Modelo do rodapé das mensagens: campos entre chaves e o símbolo antes do número do parágrafo. */
function FooterEditor() {
  const { settings, saveSettings } = useApp(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings })))
  const tpl = settings.msgFooter || DEFAULT_MSG_FOOTER
  const set = (v: string) => saveSettings({ msgFooter: v })
  const sample = { codigo: '63-0324N', titulo: 'O Sétimo Selo', num: 12, local: 'Jeffersonville, Indiana', traducao: 'GVD' }
  // troca o que vem grudado antes do {num} (o "§") pelo símbolo escolhido
  const symbol = (sym: string) => set(tpl.includes('{num}') ? tpl.replace(/[^·|•{}]*\{num\}/, (m) => `${m.startsWith(' ') ? ' ' : ''}${sym}{num}`) : `${tpl} · ${sym}{num}`)
  const FIELDS: [string, string][] = [
    ['{codigo}', 'código'],
    ['{titulo}', 'título'],
    ['{num}', 'nº do §'],
    ['{local}', 'local'],
    ['{traducao}', 'tradução'],
  ]
  return (
    <div className="footer-editor">
      <label className="frow">
        Rodapé das mensagens
        <input className="grow" value={settings.msgFooter} onChange={(e) => set(e.target.value)} placeholder={DEFAULT_MSG_FOOTER} />
        <button className="small" onClick={() => set(DEFAULT_MSG_FOOTER)} title="Voltar ao padrão">
          Padrão
        </button>
      </label>
      <div className="row-buttons wrap">
        <span className="hint">Símbolo antes do número:</span>
        {['§', '¶', 'nº ', '# ', 'par. ', ''].map((s) => (
          <button key={s || 'nada'} className="small" onClick={() => symbol(s)}>
            {s.trim() || 'sem símbolo'}
          </button>
        ))}
      </div>
      <div className="row-buttons wrap">
        <span className="hint">Inserir:</span>
        {FIELDS.map(([f, label]) => (
          <button key={f} className="small" onClick={() => set(`${tpl} · ${f}`)} title={`Acrescenta ${f} no fim`}>
            {label}
          </button>
        ))}
      </div>
      <p className="hint">
        Exemplo: <b>{msgFooter(tpl, sample)}</b> — o tamanho e a cor do rodapé ficam no tema.
      </p>
    </div>
  )
}

function MessagesTab() {
  const { toast, fail, request } = useApp(useShallow((s) => ({ toast: s.toast, fail: s.fail, request: s.request })))
  const hub = useHubSync()
  const [stats, setStats] = useState<MsgStats | null>(null)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({})

  const refresh = async () => {
    setStats(await api.msgStats())
    setSettingsMap(await api.getSettings())
  }
  useEffect(() => {
    refresh().catch(fail)
    api.msgDefaultLocalPath().then((p) => p && setPath((cur) => cur || p)).catch(() => {})
    const un = listen<{ done: number; total: number }>('msg-sync', (e) => setProgress(e.payload))
    return () => {
      un.then((f) => f())
    }
  }, [fail])

  const fmt = (ts?: string) => (ts ? new Date(+ts * 1000).toLocaleString('pt-BR') : 'nunca')

  return (
    <div className="form">
      {stats && (
        <div className="stat-grid">
          <div>
            <b>{stats.groups.toLocaleString('pt-BR')}</b>
            <span>mensagens (datas)</span>
          </div>
          <div>
            <b>{stats.with_text.toLocaleString('pt-BR')}</b>
            <span>com texto em português</span>
          </div>
          <div>
            <b>{stats.multi.toLocaleString('pt-BR')}</b>
            <span>com mais de uma tradução</span>
          </div>
          <div>
            <b>{stats.paragraphs.toLocaleString('pt-BR')}</b>
            <span>parágrafos pesquisáveis</span>
          </div>
        </div>
      )}
      <h3>Banco local (database-mensagens)</h3>
      <div className="row-buttons">
        <input className="grow" value={path} onChange={(e) => setPath(e.target.value)} placeholder="caminho do mensagens.db" />
        <button
          onClick={async () => {
            const p = await openDialog({ multiple: false, filters: [{ name: 'mensagens.db', extensions: ['db', 'sqlite'] }] })
            if (p && !Array.isArray(p)) setPath(String(p))
          }}
        >
          Escolher…
        </button>
        <button
          className="primary"
          disabled={!path || !!busy}
          onClick={async () => {
            setBusy('Importando banco local…')
            try {
              const r = await api.msgImportLocal(path)
              toast(`${r.with_text} mensagens com texto · ${r.paragraphs.toLocaleString('pt-BR')} parágrafos`, 'ok')
              request('msg-data-changed', null)
              await refresh()
            } catch (e) {
              fail(e)
            } finally {
              setBusy('')
            }
          }}
        >
          Importar / atualizar
        </button>
      </div>
      <p className="hint">Última importação: {fmt(settingsMap.msg_local_path_imported)}</p>

      <h3>Busca CBB (crentesdabiblia.com.br)</h3>
      <p className="hint">
        Baixa as mensagens da API pública do site (a mesma que o app usa para o modo offline). Mensagens da mesma data ficam juntas com as do banco local — você
        escolhe a tradução no leitor.
      </p>
      <div className="row-buttons">
        <button
          className="primary"
          disabled={!!busy}
          onClick={async () => {
            setBusy('Sincronizando Busca CBB…')
            setProgress({ done: 0, total: 0 })
            try {
              const n = await api.msgSyncCbb()
              toast(`Busca CBB: ${n} mensagens sincronizadas`, 'ok')
              request('msg-data-changed', null)
              await refresh()
            } catch (e) {
              fail(errText(e))
            } finally {
              setBusy('')
            }
          }}
        >
          <Icon name="sync" /> Sincronizar agora
        </button>
        {progress && busy.includes('CBB') && (
          <div className="progress">
            <div style={{ width: progress.total ? `${(100 * progress.done) / progress.total}%` : '5%' }} />
            <span>
              {progress.done}/{progress.total || '?'}
            </span>
          </div>
        )}
      </div>
      <p className="hint">Última sincronização: {fmt(settingsMap.cbb_synced_at)}</p>

      <h3>Tabernáculo da Fé (busca.tabernaculodafe.org.br)</h3>
      <p className="hint">
        Baixa as mensagens da API pública do site do Busca: as traduções do Tabernáculo da Fé (GO) e das Gravações "A Voz de Deus" (GVD), na revisão mais nova.
        Quando o banco local ou o Busca CBB têm o mesmo texto, a cópia antiga fica escondida (não é apagada). Da segunda vez em diante só baixa o que for novo ou
        revisado.
      </p>
      <div className="row-buttons">
        <button
          className="primary"
          disabled={!!busy}
          onClick={async () => {
            setBusy('Sincronizando Tabernáculo da Fé…')
            setProgress({ done: 0, total: 0 })
            try {
              const r = await api.msgSyncTdf()
              toast(`Tabernáculo da Fé: ${r.downloaded} de ${r.total} mensagens baixadas · ${r.superseded} cópias antigas escondidas`, 'ok')
              request('msg-data-changed', null)
              await refresh()
            } catch (e) {
              fail(errText(e))
            } finally {
              setBusy('')
            }
          }}
        >
          <Icon name="sync" /> Sincronizar agora
        </button>
        {progress && busy.includes('Tabernáculo') && (
          <div className="progress">
            <div style={{ width: progress.total ? `${(100 * progress.done) / progress.total}%` : '5%' }} />
            <span>
              {progress.done}/{progress.total || '?'}
            </span>
          </div>
        )}
      </div>
      <p className="hint">
        Última sincronização: {fmt(settingsMap.tdf_synced_at)}
        {stats && stats.superseded > 0 && ` · ${stats.superseded.toLocaleString('pt-BR')} cópias antigas escondidas (aparecem se filtrar pela fonte)`}
      </p>

      <h3>MessageHub (messagehub.info · Português-B)</h3>
      <p className="hint">
        Baixa as mensagens em português do MessageHub (tradução Crentes da Bíblia do Brasil, {hub.listed ? `${hub.listed} no site` : 'cerca de 670'}). O site só tem
        PDF: cada mensagem é baixada e o texto é lido do PDF. Onde o Busca CBB tem o mesmo texto, a cópia antiga fica escondida. Da segunda vez em diante só baixa o
        que for novo ou revisado. A primeira vez leva uns 10 minutos; pode fechar esta janela que continua.
      </p>
      <div className="row-buttons">
        <button
          className="primary"
          disabled={hub.running || !!busy}
          onClick={async () => {
            try {
              toast(await syncHub(), 'ok')
              await refresh()
            } catch (e) {
              fail(errText(e))
            }
          }}
        >
          <Icon name="sync" /> {hub.running ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
        {hub.running && (
          <>
            <div className="progress">
              <div style={{ width: hub.total ? `${(100 * hub.done) / hub.total}%` : '5%' }} />
              <span>{hub.total ? `${hub.done}/${hub.total}` : hub.phase}</span>
            </div>
            <button onClick={() => useHubSync.setState({ stop: true })} title="Para depois da mensagem atual (o que já veio fica gravado)">
              Parar
            </button>
          </>
        )}
      </div>
      <p className="hint">
        Última sincronização: {fmt(settingsMap.hub_synced_at)}
        {hub.failed.length > 0 && ` · ${hub.failed.length} com problema: ${hub.failed.slice(0, 3).join('; ')}${hub.failed.length > 3 ? '…' : ''}`}
      </p>

      <h3>Livros e séries (Eras, Selos) — zip ou pasta de TXT</h3>
      <p className="hint">
        Escolha o zip (ou a pasta) com os TXT: o livro "Uma Exposição das Sete Eras da Igreja" entra com um capítulo por mensagem (códigos ERAS-01 a ERAS-10);
        as mensagens dos Selos só entram se o texto ainda não estiver no banco. Importar de novo atualiza, não duplica.
      </p>
      <div className="row-buttons">
        <button
          className="primary"
          disabled={!!busy || hub.running}
          onClick={async () => {
            const p = await openDialog({ multiple: false, title: 'Zip com os TXT (Eras, Selos)', filters: [{ name: 'Zip', extensions: ['zip'] }] })
            if (!p || Array.isArray(p)) return
            setBusy('Importando livros…')
            try {
              const r = await api.msgImportBooks(String(p))
              const parts = [`Eras: ${r.eras_chapters} capítulos (${r.eras_paragraphs.toLocaleString('pt-BR')} blocos)`]
              if (r.selos_same + r.selos_new) parts.push(`Selos: ${r.selos_same} já estavam no banco com o mesmo texto, ${r.selos_new} nova(s)`)
              if (r.ignored.length) parts.push(`${r.ignored.length} arquivo(s) ignorado(s)`)
              toast(parts.join(' · '), 'ok')
              request('msg-data-changed', null)
              await refresh()
            } catch (e) {
              fail(errText(e))
            } finally {
              setBusy('')
            }
          }}
        >
          Importar zip…
        </button>
        <button
          disabled={!!busy || hub.running}
          onClick={async () => {
            const p = await openDialog({ directory: true, multiple: false, title: 'Pasta com os TXT (Eras, Selos)' })
            if (!p || Array.isArray(p)) return
            setBusy('Importando livros…')
            try {
              const r = await api.msgImportBooks(String(p))
              toast(`Eras: ${r.eras_chapters} capítulos · Selos: ${r.selos_same} já estavam, ${r.selos_new} nova(s)${r.ignored.length ? ` · ${r.ignored.length} ignorado(s)` : ''}`, 'ok')
              request('msg-data-changed', null)
              await refresh()
            } catch (e) {
              fail(errText(e))
            } finally {
              setBusy('')
            }
          }}
        >
          Importar pasta…
        </button>
      </div>

      <h3>The Table (VGR)</h3>
      <p className="hint">
        O conteúdo do The Table exige login e é protegido, então não é copiado. A pesquisa daqui segue os mesmos modos dele (todas as palavras, frase exata,
        proximidade, código de data, variações, curingas, filtros por ano/local e ordenação). Trechos copiados do The Table podem ser colados em Textos →
        Importar.
      </p>
      {stats && stats.translations.length > 0 && (
        <>
          <h3>Traduções no banco</h3>
          <div className="chips">
            {stats.translations.map(([t, n]) => (
              <span key={t} className="chip">
                {t} <small>{n}</small>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function HolyricsTab() {
  const { settings, saveSettings, toast, fail } = useApp(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings, toast: s.toast, fail: s.fail })))
  const [cfg, setCfg] = useState({ host: '127.0.0.1', port: 8091, token: '' })
  const [versions, setVersions] = useState<{ key: string; title: string }[]>([])
  useEffect(() => {
    api.getSettings().then((m) => m.holyrics && setCfg({ ...cfg, ...JSON.parse(m.holyrics) })).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const save = async () => {
    await api.setSetting('holyrics', JSON.stringify(cfg))
  }
  return (
    <div className="form">
      <p className="hint">
        No Holyrics: <b>Arquivo → Configurações → API Server</b>, ative o servidor e crie um token com permissão para <i>ShowVerse</i>,
        <i> ShowQuickPresentation</i> e <i>GetBibleVersionsV2</i>. O Holyrics projeta com as Bíblias dele (NVI, ACF, NAA…).
      </p>
      <div className="row3">
        <label>
          Endereço
          <input value={cfg.host} onChange={(e) => setCfg({ ...cfg, host: e.target.value })} />
        </label>
        <label>
          Porta
          <input type="number" value={cfg.port} onChange={(e) => setCfg({ ...cfg, port: +e.target.value })} />
        </label>
        <label>
          Token
          <input value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} type="password" />
        </label>
      </div>
      <div className="row-buttons">
        <button
          className="primary"
          onClick={async () => {
            try {
              await save()
              const v = (await api.holyricsVersions()) as { key: string; title: string }[]
              setVersions(Array.isArray(v) ? v : [])
              toast(`Holyrics respondeu: ${Array.isArray(v) ? v.length : 0} versões da Bíblia`, 'ok')
            } catch (e) {
              fail(e)
            }
          }}
        >
          Salvar e testar
        </button>
      </div>
      <label className="frow">
        <input type="checkbox" checked={settings.bibleViaHolyrics} onChange={(e) => saveSettings({ bibleViaHolyrics: e.target.checked })} />
        <b>Projetar a Bíblia pelo Holyrics</b> (ACF, NVI, KJA… que estão no Holyrics). Clique no versículo, setas, F8/F9/F10 e Esc passam a controlar o Holyrics.
      </label>
      <label className="frow">
        Versão usada ao enviar versículos
        <select value={settings.holyricsVersion} onChange={(e) => saveSettings({ holyricsVersion: e.target.value })}>
          <option value="">a selecionada no Holyrics</option>
          {versions.map((v) => (
            <option key={v.key} value={v.key}>
              {v.title}
            </option>
          ))}
          {settings.holyricsVersion && !versions.some((v) => v.key === settings.holyricsVersion) && <option value={settings.holyricsVersion}>{settings.holyricsVersion}</option>}
        </select>
      </label>
    </div>
  )
}

function AboutTab() {
  const [info, setInfo] = useState<{ db_path: string; data_dir: string; version: string } | null>(null)
  useEffect(() => {
    api.appInfo().then(setInfo).catch(() => {})
  }, [])
  return (
    <div className="form">
      <h3>AVDP Busca {info?.version}</h3>
      <p className="hint">Dados: {info?.data_dir}</p>
      <p className="hint">Banco: {info?.db_path}</p>
      <h3>Como usar</h3>
      <p className="hint">
        Clique num slide para projetar. Na Bíblia, digite a referência (jo 3 16) ou palavras. Nas Mensagens, a lista mostra cada data com as traduções
        disponíveis; no leitor, escolha a tradução e use {prettyCombo('Ctrl+Shift+F')} para procurar dentro da mensagem. Os atalhos seguem o Holyrics e podem
        ser trocados na aba Atalhos.
      </p>
    </div>
  )
}

function HotkeysTab() {
  const { settings, saveSettings } = useApp(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings })))
  const [capturing, setCapturing] = useState<{ id: ActionId; index: number } | null>(null)
  const [msg, setMsg] = useState('')
  const map = effectiveMap(settings.hotkeys)

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        setCapturing(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return
      if (isBareCharacter(combo)) {
        setMsg(`"${prettyCombo(combo)}" sozinha não pode (digitar dispararia a ação). Use com Ctrl ou Alt, ou uma tecla F.`)
        return
      }
      const other = map.get(combo)
      const cur = [...keysFor(capturing.id, settings.hotkeys)]
      cur[capturing.index] = combo
      const next = { ...settings.hotkeys, [capturing.id]: Array.from(new Set(cur.filter(Boolean))) }
      if (other && other !== capturing.id) {
        next[other] = keysFor(other, settings.hotkeys).filter((c) => c !== combo)
        setMsg(`${prettyCombo(combo)} saiu de "${ACTIONS.find((a) => a.id === other)?.label}".`)
      } else setMsg('')
      saveSettings({ hotkeys: next })
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, map, settings.hotkeys, saveSettings])

  const groups = Array.from(new Set(ACTIONS.map((a) => a.group)))
  return (
    <div className="form">
      <p className="hint">
        Padrões do Holyrics: F8 papel de parede, F9 slide sem texto, F10 tela preta, F5 projetar do início, Shift+F5 do slide selecionado, Ctrl+F pesquisar,
        Ctrl+Shift+F pesquisa no livro / na mensagem, Ctrl+setas escolhe e projeta ao soltar o Ctrl. Clique numa tecla para trocar; Esc cancela.
      </p>
      {msg && <div className="banner">{msg}</div>}
      {groups.map((g) => (
        <div key={g}>
          <h3>{g}</h3>
          <table className="table hotkeys">
            <tbody>
              {ACTIONS.filter((a) => a.group === g).map((a) => {
                const keys = keysFor(a.id, settings.hotkeys)
                return (
                  <tr key={a.id}>
                    <td>{a.label}</td>
                    <td className="keys">
                      {[...keys, ''].map((c, i) => (
                        <button
                          key={i}
                          className={`keycap${capturing?.id === a.id && capturing.index === i ? ' capturing' : ''}${c ? '' : ' add'}`}
                          onClick={() => setCapturing({ id: a.id, index: i })}
                          title={c ? 'Clique e aperte a nova tecla' : 'Adicionar outra tecla'}
                        >
                          {capturing?.id === a.id && capturing.index === i ? 'aperte…' : c ? prettyCombo(c) : '+'}
                        </button>
                      ))}
                      {keys.length > 0 && (
                        <button className="icon-btn tiny" title="Tirar a última tecla" onClick={() => saveSettings({ hotkeys: { ...settings.hotkeys, [a.id]: keys.slice(0, -1) } })}>
                          <Icon name="x" size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div className="row-buttons">
        <button onClick={async () => (await confirm('Voltar todos os atalhos para o padrão do Holyrics?')) && saveSettings({ hotkeys: {} })}>Restaurar padrão</button>
      </div>
    </div>
  )
}
