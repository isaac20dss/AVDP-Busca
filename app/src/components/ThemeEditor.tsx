// Editor de tema com prévia ao vivo (fundo, fonte, tamanho, cores, alinhamento, sombra, contorno, rodapé).
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { api } from '../api'
import { autoMerge, chunkOfTheme, preloadThemeFonts } from '../lib/fit'
import { FONTS, margins, parseTheme } from '../lib/theme'
import { useApp } from '../store'
import type { ThemeData, ThemeRow } from '../types'
import { Modal } from './Modal'
import { SlideRender } from './SlideRender'
import { Icon } from './icons'
import { useShallow } from 'zustand/react/shallow'

const SAMPLE = 'Grandioso és Tu, Senhor\nTua glória enche a terra\nE os céus proclamam\nO Teu poder'

export function ThemeEditor({ initial }: { initial: ThemeRow }) {
  const { setModal, loadThemes, fail, toast, sendLive, themes } = useApp(useShallow((s) => ({ setModal: s.setModal, loadThemes: s.loadThemes, fail: s.fail, toast: s.toast, sendLive: s.sendLive, themes: s.themes })))
  const [name, setName] = useState(initial.name)
  const [t, setT] = useState<ThemeData>(parseTheme(initial))
  const [sample, setSample] = useState(SAMPLE)
  const set = (p: Partial<ThemeData>) => setT((x) => ({ ...x, ...p }))
  const mg = margins(t)
  const chunkHere = chunkOfTheme(t)
  const close = () => setModal(null)

  const save = async () => {
    try {
      await api.themeSave({ id: initial.id, name: name || 'Tema', data: JSON.stringify(t) })
      await loadThemes()
      await preloadThemeFonts()
      sendLive()
      toast('Tema salvo', 'ok')
      close()
    } catch (e) {
      fail(e)
    }
  }

  const pickImage = async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: 'Imagem', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }] })
    if (!p || Array.isArray(p)) return
    const stored = await api.themeStoreImage(String(p))
    set({ bg: { ...t.bg, kind: 'image', image: stored } })
  }

  return (
    <Modal
      title="Tema"
      onClose={close}
      wide
      footer={
        <>
          {initial.id > 0 && themes.length > 1 && (
            <button
              className="danger"
              onClick={async () => {
                if (!(await confirm(`Excluir o tema "${initial.name}"?`))) return
                await api.themeDelete(initial.id).catch(fail)
                await loadThemes()
                close()
              }}
            >
              <Icon name="trash" /> Excluir
            </button>
          )}
          <span className="grow" />
          <button onClick={close}>Cancelar</button>
          <button className="primary" onClick={save}>
            <Icon name="check" /> Salvar
          </button>
        </>
      }
    >
      <div className="theme-editor">
        <div className="form">
          <label>
            Nome
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <h3>Fundo</h3>
          <div className="seg">
            {(['color', 'gradient', 'image'] as const).map((k) => (
              <button key={k} className={t.bg.kind === k ? 'on' : ''} onClick={() => set({ bg: { ...t.bg, kind: k } })}>
                {k === 'color' ? 'Cor' : k === 'gradient' ? 'Degradê' : 'Imagem'}
              </button>
            ))}
          </div>
          {t.bg.kind === 'color' && <input type="color" value={t.bg.color ?? '#000000'} onChange={(e) => set({ bg: { ...t.bg, color: e.target.value } })} />}
          {t.bg.kind === 'gradient' && (
            <input value={t.bg.gradient ?? ''} onChange={(e) => set({ bg: { ...t.bg, gradient: e.target.value } })} placeholder="linear-gradient(160deg, #0b1d3a, #071226)" />
          )}
          {t.bg.kind === 'image' && (
            <div className="row-buttons">
              <button onClick={() => pickImage().catch(fail)}>
                <Icon name="upload" /> Escolher imagem
              </button>
              <label className="frow">
                Escurecer
                <input type="range" min={0} max={0.8} step={0.05} value={t.bg.dim ?? 0} onChange={(e) => set({ bg: { ...t.bg, dim: +e.target.value } })} />
              </label>
            </div>
          )}
          <h3>Texto</h3>
          <div className="row2">
            <label>
              Fonte
              <select value={t.font} onChange={(e) => set({ font: e.target.value })}>
                {FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tamanho da letra (% da altura)
              <span className="size-row">
                <input type="range" min={2.5} max={30} step={0.1} value={t.size} onChange={(e) => set({ size: +e.target.value })} />
                <input
                  type="number"
                  min={2.5}
                  max={30}
                  step={0.5}
                  value={+t.size.toFixed(1)}
                  onChange={(e) => e.target.value !== '' && set({ size: Math.min(30, Math.max(2.5, +e.target.value)) })}
                  aria-label="Tamanho da letra em porcentagem"
                />
                %
              </span>
            </label>
          </div>
          <div className="fit-row">
            <span className="hint">
              Com esta letra cabem até <b>{chunkHere}</b> caracteres por slide nas mensagens e textos
              {useApp.getState().settings.slide.autoChunk ? '' : ' (número fixo das Configurações)'}.
            </span>
            <label className="frow">
              <input
                type="checkbox"
                checked={t.mergeChars == null}
                onChange={(e) => set({ mergeChars: e.target.checked ? undefined : autoMerge(chunkHere) })}
              />
              Juntar pedaço curto ao vizinho: automático
              {t.mergeChars == null && <small className="hint">(pedaço com menos de {autoMerge(chunkHere)} caracteres vai junto; só esse slide fica com a letra menor)</small>}
            </label>
            {t.mergeChars != null && (
              <label className="frow">
                Juntar pedaço com menos de
                <input type="number" min={0} max={2000} step={5} value={t.mergeChars} onChange={(e) => set({ mergeChars: Math.max(0, +e.target.value) })} />
                caracteres <small className="hint">(0 = nunca juntar)</small>
              </label>
            )}
          </div>
          <div className="row3">
            <label>
              Cor
              <input type="color" value={t.color} onChange={(e) => set({ color: e.target.value })} />
            </label>
            <label>
              Entrelinha
              <input type="number" min={0.9} max={2.2} step={0.05} value={t.lineHeight} onChange={(e) => set({ lineHeight: +e.target.value })} />
            </label>
          </div>
          <div className="row3">
            <label>
              Margem superior (%)
              <input type="number" min={0} max={40} step={0.5} value={mg.top} onChange={(e) => set({ paddingTop: +e.target.value })} />
            </label>
            <label>
              Margem inferior (%)
              <input type="number" min={0} max={40} step={0.5} value={mg.bottom} onChange={(e) => set({ paddingBottom: +e.target.value })} />
            </label>
            <label>
              Margens laterais (%)
              <input type="number" min={0} max={40} step={0.5} value={+mg.side.toFixed(1)} onChange={(e) => set({ paddingSide: +e.target.value })} />
            </label>
          </div>
          <div className="checks">
            <label>
              <input type="checkbox" checked={t.bold} onChange={(e) => set({ bold: e.target.checked })} /> Negrito
            </label>
            <label>
              <input type="checkbox" checked={t.italic} onChange={(e) => set({ italic: e.target.checked })} /> Itálico
            </label>
            <label>
              <input type="checkbox" checked={t.uppercase} onChange={(e) => set({ uppercase: e.target.checked })} /> MAIÚSCULAS
            </label>
            <label>
              <input type="checkbox" checked={t.shadow} onChange={(e) => set({ shadow: e.target.checked })} /> Sombra
            </label>
            <label>
              <input type="checkbox" checked={!!t.band} onChange={(e) => set({ band: e.target.checked })} /> Faixa (tarja)
            </label>
          </div>
          <div className="row3">
            <label>
              Alinhamento
              <select value={t.align} onChange={(e) => set({ align: e.target.value as ThemeData['align'] })}>
                <option value="left">Esquerda</option>
                <option value="center">Centro</option>
                <option value="right">Direita</option>
                <option value="justify">Justificado</option>
              </select>
            </label>
            <label>
              Posição
              <select value={t.valign} onChange={(e) => set({ valign: e.target.value as ThemeData['valign'] })}>
                <option value="top">Em cima</option>
                <option value="middle">Meio</option>
                <option value="bottom">Embaixo</option>
              </select>
            </label>
            <label>
              Contorno
              <input type="number" min={0} max={10} step={0.5} value={t.outline} onChange={(e) => set({ outline: +e.target.value })} />
            </label>
          </div>
          <h3>Rodapé (referência)</h3>
          <div className="row3">
            <label className="frow">
              <input type="checkbox" checked={t.footer.show} onChange={(e) => set({ footer: { ...t.footer, show: e.target.checked } })} /> Mostrar
            </label>
            <label>
              Tamanho
              <input type="number" min={1.5} max={6} step={0.1} value={t.footer.size} onChange={(e) => set({ footer: { ...t.footer, size: +e.target.value } })} />
            </label>
            <label>
              Cor
              <input type="color" value={t.footer.color} onChange={(e) => set({ footer: { ...t.footer, color: e.target.value } })} />
            </label>
          </div>
        </div>
        <div className="theme-preview">
          <div className="preview-frame">
            <SlideRender slide={{ text: sample, footer: 'João 3:16 (BPM)' }} theme={t} />
          </div>
          <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={5} />
        </div>
      </div>
    </Modal>
  )
}
