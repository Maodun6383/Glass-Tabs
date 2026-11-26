import * as alphaTab from '@coderline/alphatab'
import type { RightFinger, TabBar, TabColumn, TabNote, TabTrack, TrackInfo } from './model'

type Score = alphaTab.model.Score

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const RIGHT: Record<number, RightFinger> = { 0: 'p', 1: 'i', 2: 'm', 3: 'a', 4: 'c' }

/** Parse any format alphaTab understands (gp3/gp4/gp5/gpx/gp, MusicXML, alphaTex …). */
export function loadScore(bytes: Uint8Array): Score {
  const settings = new alphaTab.Settings()
  settings.core.logLevel = alphaTab.LogLevel.Error
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
}

export function listTracks(score: Score): TrackInfo[] {
  return score.tracks.map((t, index) => {
    const staff = t.staves[0]
    return {
      index,
      name: t.name || `Track ${index + 1}`,
      strings: staff?.tuning.length ?? 0,
      percussion: !!staff?.isPercussion,
    }
  })
}

/** Default track: first non-percussion 6-string track, otherwise the first fretted one. */
export function defaultTrackIndex(tracks: TrackInfo[]): number {
  const six = tracks.find((t) => !t.percussion && t.strings === 6)
  if (six) return six.index
  const fretted = tracks.find((t) => !t.percussion && t.strings > 0)
  return fretted ? fretted.index : 0
}

export function stringNames(tuning: number[]): string[] {
  const letters = tuning.map((m) => NOTE_NAMES[((m % 12) + 12) % 12])
  // tuning is top→bottom (high→low). Lower-case a higher string whose name
  // repeats further down, so standard tuning reads e B G D A E.
  return letters.map((l, i) => (letters.slice(i + 1).includes(l) ? l.toLowerCase() : l))
}

export function buildTrack(score: Score, trackIndex: number): TabTrack {
  const track = score.tracks[trackIndex]
  if (!track) throw new Error(`Track ${trackIndex} not found`)
  const staff = track.staves[0]
  const tuning = [...staff.tuning] // alphaTab: index 0 = highest string
  const stringCount = tuning.length

  const bars: TabBar[] = []
  let prevSig = ''
  for (const bar of staff.bars) {
    const mb = bar.masterBar
    const length = mb.calculateDuration()
    const timeSig = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`

    // Merge every voice into one column per onset tick.
    const byTick = new Map<number, TabColumn>()
    for (const voice of bar.voices) {
      if (voice.isEmpty) continue
      for (const beat of voice.beats) {
        if (beat.graceType !== alphaTab.model.GraceType.None) continue // v0.1: skip grace notes
        const tick = beat.playbackStart
        let col = byTick.get(tick)
        if (!col) {
          col = { tick, span: 0, notes: [], rest: true }
          byTick.set(tick, col)
        }
        if (beat.chord?.name && !col.chord) col.chord = beat.chord.name
        for (const n of beat.notes) {
          // alphaTab: string 1 = lowest, string N = highest → line 0 = highest
          const line = stringCount - n.string
          if (line < 0 || line >= stringCount) continue
          if (col.notes.some((x) => x.line === line)) continue
          const note: TabNote = {
            line,
            fret: n.fret,
            tied: n.isTieDestination,
            dead: n.isDead,
            harmonic: n.harmonicType !== alphaTab.model.HarmonicType.None,
          }
          if (n.leftHandFinger >= 0) note.leftFinger = n.leftHandFinger
          if (n.rightHandFinger >= 0) note.rightFinger = RIGHT[n.rightHandFinger]
          col.notes.push(note)
        }
        if (beat.notes.length > 0 && !beat.isRest) col.rest = false
      }
    }

    const columns = [...byTick.values()].sort((a, b) => a.tick - b.tick)
    columns.forEach((c, i) => {
      const next = i + 1 < columns.length ? columns[i + 1].tick : length
      c.span = Math.max(0, next - c.tick)
    })

    bars.push({
      number: bar.index + 1,
      timeSig,
      showTimeSig: timeSig !== prevSig,
      repeatStart: mb.isRepeatStart,
      repeatEnd: mb.repeatCount,
      startTick: mb.start,
      lengthTicks: length,
      columns,
    })
    prevSig = timeSig
  }

  return {
    title: score.title || 'Untitled',
    artist: score.artist || '',
    trackName: track.name || `Track ${trackIndex + 1}`,
    tempo: score.tempo,
    stringNames: stringNames(tuning),
    tuning,
    bars,
  }
}
