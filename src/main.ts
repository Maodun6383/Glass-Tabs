import './style.css'
import type * as alphaTab from '@coderline/alphatab'
import { Glasses, type GlassesAction } from './glasses'
import { CANVAS_H, CANVAS_W, layoutTrack, type TabSystem } from './layout'
import type { TabTrack } from './model'
import { makeMeasure, type Ctx2D } from './render'
import { buildTrack, defaultTrackIndex, listTracks, loadScore } from './score'
import { renderScreen } from './screen'
import { Store } from './storage'

type Score = alphaTab.model.Score

interface Settings {
  showFingering: boolean
  dimNext: boolean
  tapAdvances: boolean
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const ui = {
  status: $('status'),
  file: $<HTMLInputElement>('file'),
  fileName: $('file-name'),
  track: $<HTMLSelectElement>('track'),
  fingering: $<HTMLInputElement>('opt-fingering'),
  dim: $<HTMLInputElement>('opt-dim'),
  tap: $<HTMLInputElement>('opt-tap'),
  preview: $<HTMLCanvasElement>('preview'),
  prev: $<HTMLButtonElement>('btn-prev'),
  next: $<HTMLButtonElement>('btn-next'),
  pos: $('pos'),
  info: $('song-info'),
}

const frame = document.createElement('canvas')
frame.width = CANVAS_W
frame.height = CANVAS_H
const frameCtx = frame.getContext('2d') as unknown as Ctx2D
const measure = makeMeasure(frameCtx)

let score: Score | null = null
let track: TabTrack | null = null
let systems: TabSystem[] = []
let page = 0
let fileKey = ''
let settings: Settings = { showFingering: true, dimNext: true, tapAdvances: true }

const glasses = new Glasses(onGlassesAction)
const store = new Store(glasses)

function setStatus(text: string): void {
  ui.status.textContent = text
}

function draw(): void {
  if (!track) return
  renderScreen(frameCtx, systems, page, track.stringNames, {
    showFingering: settings.showFingering,
    dimNext: settings.dimNext,
  })
  const p = ui.preview.getContext('2d')!
  p.drawImage(frame, 0, 0)
  ui.pos.textContent = systems.length
    ? `Satır ${page + 1}/${systems.length} · Ölçü ${systems[page].firstBar}–${systems[page].lastBar}`
    : ''
  void glasses.pushFrame(frame)
}

function go(delta: number): void {
  if (!systems.length) return
  const target = Math.max(0, Math.min(systems.length - 1, page + delta))
  if (target === page) return
  page = target
  draw()
  void store.set(`pos:${fileKey}`, String(systems[page].firstBar))
}

function onGlassesAction(a: GlassesAction): void {
  switch (a) {
    case 'next':
      go(1)
      break
    case 'prev':
      go(-1)
      break
    case 'tap':
      if (settings.tapAdvances) go(1)
      break
    case 'exit':
      void glasses.exit()
      break
    case 'foreground':
      draw()
      break
  }
}

function selectTrack(index: number, startBar = 1): void {
  if (!score) return
  track = buildTrack(score, index)
  systems = layoutTrack(track, measure)
  const found = systems.findIndex((s) => s.lastBar >= startBar)
  page = found >= 0 ? found : 0
  ui.info.textContent = [track.title, track.artist, track.trackName].filter(Boolean).join(' · ')
  draw()
}

function openScore(bytes: Uint8Array, name: string, trackIndex?: number, startBar = 1): void {
  try {
    score = loadScore(bytes)
  } catch (err) {
    setStatus(`Dosya okunamadı: ${(err as Error).message}`)
    return
  }
  fileKey = `${name}:${bytes.length}`
  ui.fileName.textContent = name
  const tracks = listTracks(score)
  ui.track.innerHTML = ''
  for (const t of tracks) {
    const o = document.createElement('option')
    o.value = String(t.index)
    o.textContent = `${t.name}${t.percussion ? ' (perküsyon)' : ` · ${t.strings} tel`}`
    o.disabled = t.percussion || t.strings === 0
    ui.track.appendChild(o)
  }
  const ti = trackIndex ?? defaultTrackIndex(tracks)
  ui.track.value = String(ti)
  selectTrack(ti, startBar)
}

async function onFile(): Promise<void> {
  const f = ui.file.files?.[0]
  if (!f) return
  const bytes = new Uint8Array(await f.arrayBuffer())
  openScore(bytes, f.name)
  await store.saveLastFile(f.name, bytes)
  await store.set('track', ui.track.value)
}

function bindSettings(): void {
  ui.fingering.checked = settings.showFingering
  ui.dim.checked = settings.dimNext
  ui.tap.checked = settings.tapAdvances
  const update = () => {
    settings = {
      showFingering: ui.fingering.checked,
      dimNext: ui.dim.checked,
      tapAdvances: ui.tap.checked,
    }
    void store.set('settings', JSON.stringify(settings))
    draw()
  }
  ui.fingering.onchange = update
  ui.dim.onchange = update
  ui.tap.onchange = update
}

async function boot(): Promise<void> {
  ui.file.onchange = () => void onFile()
  ui.track.onchange = () => {
    selectTrack(Number(ui.track.value))
    void store.set('track', ui.track.value)
  }
  ui.prev.onclick = () => go(-1)
  ui.next.onclick = () => go(1)

  setStatus('Gözlüğe bağlanılıyor…')
  const ok = await glasses.connect()
  setStatus(ok ? 'Gözlük bağlı' : 'Gözlük yok – yalnızca önizleme modu')

  await store.init()
  try {
    const saved = await store.get('settings')
    if (saved) settings = { ...settings, ...JSON.parse(saved) }
  } catch {
    /* ignore bad settings */
  }
  bindSettings()

  const last = await store.loadLastFile()
  if (last) {
    const key = `${last.name}:${last.bytes.length}`
    const bar = Number((await store.get(`pos:${key}`)) || '1')
    const ti = Number((await store.get('track')) || NaN)
    openScore(last.bytes, last.name, Number.isFinite(ti) ? ti : undefined, bar)
  } else {
    const p = ui.preview.getContext('2d')!
    p.fillStyle = '#000'
    p.fillRect(0, 0, CANVAS_W, CANVAS_H)
  }
}

void boot()
