/**
 * Simplified, renderer-friendly tab model.
 * Built from an alphaTab Score by `score.ts`; consumed by `layout.ts`.
 */

export type RightFinger = 'p' | 'i' | 'm' | 'a' | 'c'

export interface TabNote {
  /** 0 = top line (highest-pitched string) */
  line: number
  fret: number
  tied: boolean
  dead: boolean
  harmonic: boolean
  /** left-hand finger 0 (thumb) .. 4, or undefined */
  leftFinger?: number
  rightFinger?: RightFinger
}

export interface TabColumn {
  /** start position inside the bar, in MIDI ticks (960 = quarter note) */
  tick: number
  /** length until the next column (or bar end), in ticks */
  span: number
  notes: TabNote[]
  chord?: string
  rest: boolean
}

export interface TabBar {
  /** 1-based bar number as printed */
  number: number
  timeSig: string
  /** set only when the time signature changes (or first bar) */
  showTimeSig: boolean
  repeatStart: boolean
  repeatEnd: number // repeat count, 0 = none
  /** absolute tick of bar start (for tempo-based follow) */
  startTick: number
  lengthTicks: number
  columns: TabColumn[]
}

export interface TabTrack {
  title: string
  artist: string
  trackName: string
  tempo: number
  /** string labels top→bottom, e.g. ['e','B','G','D','A','E'] */
  stringNames: string[]
  /** MIDI pitch per line, top→bottom */
  tuning: number[]
  bars: TabBar[]
}

export interface TrackInfo {
  index: number
  name: string
  strings: number
  percussion: boolean
}
