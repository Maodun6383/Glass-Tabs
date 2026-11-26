import type { TabBar, TabColumn, TabNote, TabTrack } from './model'

/** Glasses canvas and the band each tab system occupies. */
export const CANVAS_W = 576
export const CANVAS_H = 288
export const SYSTEM_H = 144
export const GUTTER = 16 // string names
export const RIGHT_PAD = 2

export type Measure = (text: string) => number

export interface PlacedColumn {
  col: TabColumn
  /** centre x in px */
  x: number
}

export interface PlacedBar {
  bar: TabBar
  x: number
  width: number
  columns: PlacedColumn[]
  /** this piece continues a bar split over several systems */
  continued: boolean
  /** this piece is cut and continues on the next system */
  cut: boolean
}

export interface TabSystem {
  index: number
  bars: PlacedBar[]
  firstBar: number
  lastBar: number
}

export function noteLabel(n: TabNote): string {
  if (n.dead) return 'x'
  if (n.harmonic) return `<${n.fret}>`
  if (n.tied) return `(${n.fret})`
  return String(n.fret)
}

const BAR_LEAD = 8
const BAR_TAIL = 4
const TIMESIG_W = 16

interface Piece {
  bar: TabBar
  cols: TabColumn[]
  minW: number[]
  natW: number[]
  lead: number
  continued: boolean
  cut: boolean
}

function columnWidths(col: TabColumn, measure: Measure): { min: number; nat: number } {
  const text = col.notes.reduce((w, n) => Math.max(w, measure(noteLabel(n))), measure('0'))
  const min = text + 10
  const rhythmic = 14 + 20 * Math.sqrt(Math.max(col.span, 60) / 480)
  return { min, nat: Math.max(min, rhythmic) }
}

function makePieces(bar: TabBar, measure: Measure, avail: number): Piece[] {
  const lead = BAR_LEAD + (bar.showTimeSig ? TIMESIG_W : 0)
  const minW: number[] = []
  const natW: number[] = []
  for (const c of bar.columns) {
    const w = columnWidths(c, measure)
    minW.push(w.min)
    natW.push(w.nat)
  }
  const cols = bar.columns.length ? bar.columns : []
  const total = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
  if (lead + total(minW) + BAR_TAIL <= avail) {
    return [{ bar, cols, minW, natW, lead, continued: false, cut: false }]
  }
  // Bar too dense even when squeezed: split it over several systems.
  const pieces: Piece[] = []
  let start = 0
  while (start < cols.length) {
    const pLead = pieces.length === 0 ? lead : BAR_LEAD
    let w = pLead + BAR_TAIL
    let end = start
    while (end < cols.length && w + minW[end] <= avail) w += minW[end++]
    if (end === start) end = start + 1 // pathological: one column wider than the screen
    pieces.push({
      bar,
      cols: cols.slice(start, end),
      minW: minW.slice(start, end),
      natW: natW.slice(start, end),
      lead: pLead,
      continued: start > 0,
      cut: end < cols.length,
    })
    start = end
  }
  return pieces
}

function pieceWidth(p: Piece, which: 'min' | 'nat'): number {
  const arr = which === 'min' ? p.minW : p.natW
  return p.lead + arr.reduce((a, b) => a + b, 0) + BAR_TAIL + (p.cols.length ? 0 : 24)
}

/** Break a track into screen-wide systems (lines of tab). */
export function layoutTrack(track: TabTrack, measure: Measure): TabSystem[] {
  const avail = CANVAS_W - GUTTER - RIGHT_PAD
  const pieces = track.bars.flatMap((b) => makePieces(b, measure, avail))

  // Greedy line filling on natural widths, falling back to min widths.
  const lines: Piece[][] = []
  let cur: Piece[] = []
  let curNat = 0
  let curMin = 0
  for (const p of pieces) {
    const nat = pieceWidth(p, 'nat')
    const min = pieceWidth(p, 'min')
    if (cur.length && curNat + nat > avail && curMin + min > avail) {
      lines.push(cur)
      cur = []
      curNat = 0
      curMin = 0
    } else if (cur.length && curNat + nat > avail) {
      // fits only if squeezed – accept when we save a whole line on short bars
      if (curMin + min > avail * 0.92) {
        lines.push(cur)
        cur = []
        curNat = 0
        curMin = 0
      }
    }
    cur.push(p)
    curNat += nat
    curMin += min
  }
  if (cur.length) lines.push(cur)

  return lines.map((line, index) => placeLine(line, index, avail, index === lines.length - 1))
}

function placeLine(line: Piece[], index: number, avail: number, last: boolean): TabSystem {
  const nat = line.reduce((a, p) => a + pieceWidth(p, 'nat'), 0)
  const min = line.reduce((a, p) => a + pieceWidth(p, 'min'), 0)

  // Interpolate between min and natural widths, or stretch beyond natural.
  let colWidth: (p: Piece, i: number) => number
  let fixedExtra = 0
  if (nat <= avail) {
    const fixed = line.reduce((a, p) => a + p.lead + BAR_TAIL + (p.cols.length ? 0 : 24), 0)
    const flex = nat - fixed
    let scale = flex > 0 ? (avail - fixed) / flex : 1
    if (last) scale = Math.min(scale, 1.35)
    colWidth = (p, i) => p.natW[i] * scale
    if (flex === 0) fixedExtra = 0
  } else {
    const t = nat === min ? 0 : (avail - min) / (nat - min)
    colWidth = (p, i) => p.minW[i] + (p.natW[i] - p.minW[i]) * Math.max(0, Math.min(1, t))
  }

  let x = GUTTER
  const bars: PlacedBar[] = line.map((p) => {
    const startX = x
    let cx = x + p.lead + fixedExtra
    const columns: PlacedColumn[] = p.cols.map((col, i) => {
      const w = colWidth(p, i)
      const placed = { col, x: cx + w / 2 }
      cx += w
      return placed
    })
    if (!p.cols.length) cx += 24
    const width = cx + BAR_TAIL - startX
    x = startX + width
    return { bar: p.bar, x: startX, width, columns, continued: p.continued, cut: p.cut }
  })

  return {
    index,
    bars,
    firstBar: line[0].bar.number,
    lastBar: line[line.length - 1].bar.number,
  }
}
