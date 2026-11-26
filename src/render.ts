import { CANVAS_W, GUTTER, SYSTEM_H, noteLabel, type Measure, type TabSystem } from './layout'

/** Minimal 2D-context surface shared by the browser canvas and @napi-rs/canvas. */
export interface Ctx2D {
  fillStyle: string | unknown
  strokeStyle: string | unknown
  lineWidth: number
  font: string
  textAlign: string
  textBaseline: string
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(): void
}

export interface RenderOptions {
  showFingering: boolean
  /** draw this system dimmed (used for the "next line" preview) */
  dim: boolean
  /** optional playback cursor: [barNumber, tickInBar] */
  cursor?: { bar: number; tick: number }
}

export const FRET_FONT = 'bold 16px sans-serif'
export const SMALL_FONT = '11px sans-serif'
export const LABEL_FONT = 'bold 11px sans-serif'

const STRING_TOP = 28
const STRING_GAP = 17

export function stringY(line: number, stringCount: number): number {
  // keep the stave vertically centred for 4–7 strings
  const gap = stringCount > 6 ? 15 : STRING_GAP
  const offset = (6 - Math.min(stringCount, 6)) * gap * 0.5
  return STRING_TOP + offset + line * gap
}

function grey(level: number, dim: boolean): string {
  const v = Math.round((dim ? level * 0.5 : level) * 255)
  return `rgb(${v},${v},${v})`
}

export function makeMeasure(ctx: Ctx2D): Measure {
  return (text: string) => {
    const prev = ctx.font
    ctx.font = FRET_FONT
    const w = ctx.measureText(text).width
    ctx.font = prev
    return w
  }
}

export function renderSystem(
  ctx: Ctx2D,
  sys: TabSystem,
  stringNames: string[],
  y0: number,
  opt: RenderOptions,
): void {
  const n = stringNames.length
  const top = y0 + stringY(0, n)
  const bottom = y0 + stringY(n - 1, n)
  const dim = opt.dim

  // background
  ctx.fillStyle = '#000'
  ctx.fillRect(0, y0, CANVAS_W, SYSTEM_H)

  // string names
  ctx.font = LABEL_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = grey(0.55, dim)
  stringNames.forEach((name, i) => ctx.fillText(name, GUTTER / 2, y0 + stringY(i, n)))

  // string lines
  const lastBar = sys.bars[sys.bars.length - 1]
  const lineEnd = lastBar ? lastBar.x + lastBar.width : CANVAS_W
  ctx.strokeStyle = grey(0.32, dim)
  ctx.lineWidth = 1
  for (let i = 0; i < n; i++) {
    const y = Math.round(y0 + stringY(i, n)) + 0.5
    ctx.beginPath()
    ctx.moveTo(GUTTER, y)
    ctx.lineTo(lineEnd, y)
    ctx.stroke()
  }

  for (const pb of sys.bars) {
    const bar = pb.bar
    // left barline
    vline(ctx, pb.x, top, bottom, grey(0.7, dim), 1)
    if (bar.repeatStart && !pb.continued) {
      vline(ctx, pb.x + 2, top, bottom, grey(0.9, dim), 2)
      repeatDots(ctx, pb.x + 7, y0, n, grey(0.9, dim))
    }
    const right = pb.x + pb.width
    if (bar.repeatEnd > 0 && !pb.cut) {
      vline(ctx, right - 2, top, bottom, grey(0.9, dim), 2)
      repeatDots(ctx, right - 7, y0, n, grey(0.9, dim))
      ctx.font = SMALL_FONT
      ctx.textAlign = 'right'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = grey(0.8, dim)
      ctx.fillText(`x${bar.repeatEnd}`, right - 2, top - 4)
    }

    // bar number
    if (!pb.continued) {
      ctx.font = SMALL_FONT
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = grey(0.5, dim)
      ctx.fillText(String(bar.number), pb.x + 2, y0 + 11)
    }

    // time signature
    if (bar.showTimeSig && !pb.continued) {
      const [num, den] = bar.timeSig.split('/')
      ctx.font = LABEL_FONT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = grey(0.85, dim)
      const cx = pb.x + 9 + (bar.repeatStart ? 8 : 0)
      const mid = (top + bottom) / 2
      ctx.fillStyle = '#000'
      ctx.fillRect(cx - 6, mid - 17, 12, 34)
      ctx.fillStyle = grey(0.85, dim)
      ctx.fillText(num, cx, mid - 9)
      ctx.fillText(den, cx, mid + 9)
    }

    // cursor highlight
    if (opt.cursor && opt.cursor.bar === bar.number) {
      const col = [...pb.columns].reverse().find((c) => c.col.tick <= opt.cursor!.tick)
      if (col) {
        ctx.fillStyle = grey(0.18, false)
        ctx.fillRect(col.x - 11, top - 9, 22, bottom - top + 18)
      }
    }

    for (const pc of pb.columns) {
      const col = pc.col
      if (col.chord) {
        ctx.font = SMALL_FONT
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = grey(0.75, dim)
        ctx.fillText(col.chord, pc.x - 4, y0 + 11)
      }
      ctx.font = FRET_FONT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const note of col.notes) {
        const label = noteLabel(note)
        const y = y0 + stringY(note.line, n)
        const w = ctx.measureText(label).width
        ctx.fillStyle = '#000'
        ctx.fillRect(pc.x - w / 2 - 2, y - 8, w + 4, 16)
        ctx.fillStyle = note.tied ? grey(0.5, dim) : grey(1, dim)
        ctx.fillText(label, pc.x, y + 1)
      }
      if (opt.showFingering) {
        const rh = col.notes.map((x) => x.rightFinger).filter(Boolean)
        if (rh.length) {
          ctx.font = SMALL_FONT
          ctx.textAlign = 'center'
          ctx.textBaseline = 'alphabetic'
          ctx.fillStyle = grey(0.7, dim)
          ctx.fillText(rh.join(''), pc.x, bottom + 19)
        }
      }
    }

    // final right barline of the system
    if (pb === lastBar && !(bar.repeatEnd > 0 && !pb.cut)) {
      vline(ctx, right, top, bottom, grey(0.7, dim), 1)
    }
  }
}

function vline(ctx: Ctx2D, x: number, y1: number, y2: number, color: string, w: number): void {
  ctx.strokeStyle = color
  ctx.lineWidth = w
  ctx.beginPath()
  const xx = w % 2 ? Math.round(x) + 0.5 : Math.round(x)
  ctx.moveTo(xx, y1)
  ctx.lineTo(xx, y2)
  ctx.stroke()
}

function repeatDots(ctx: Ctx2D, x: number, y0: number, n: number, color: string): void {
  ctx.fillStyle = color
  const a = Math.floor((n - 1) / 2)
  for (const line of [a, a + 1]) {
    const y = y0 + (stringY(line, n) + stringY(line + 1, n)) / 2 - 8
    ctx.beginPath()
    ctx.arc(x, y + 8, 2, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Header text drawn in the right corner of the top system: "3/24". */
export function renderPageBadge(ctx: Ctx2D, text: string): void {
  ctx.font = SMALL_FONT
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  const w = ctx.measureText(text).width
  ctx.fillStyle = '#000'
  ctx.fillRect(CANVAS_W - w - 6, 0, w + 6, 14)
  ctx.fillStyle = grey(0.6, false)
  ctx.fillText(text, CANVAS_W - 2, 11)
}
