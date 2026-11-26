import { readFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { CANVAS_W, layoutTrack } from '../src/layout'
import { makeMeasure, type Ctx2D } from '../src/render'
import { buildTrack, defaultTrackIndex, listTracks, loadScore, stringNames } from '../src/score'

const measure = makeMeasure(createCanvas(10, 10).getContext('2d') as unknown as Ctx2D)

function load(file: string) {
  const score = loadScore(new Uint8Array(readFileSync(file)))
  return buildTrack(score, defaultTrackIndex(listTracks(score)))
}

describe('score → tab model', () => {
  it('names standard tuning e B G D A E', () => {
    expect(stringNames([64, 59, 55, 50, 45, 40])).toEqual(['e', 'B', 'G', 'D', 'A', 'E'])
  })

  it('maps alphaTab strings so line 0 is the highest string', () => {
    const t = load('samples/fingering.gp')
    const n = t.bars[0].columns[0].notes[0]
    // fret 2 on the B string sounds C#4 (61) = tuning[line] + fret
    expect(t.tuning[n.line] + n.fret).toBe(61)
    expect(n.line).toBe(1)
  })

  it('reads right-hand fingering p i m a c', () => {
    const t = load('samples/fingering.gp')
    const rh = t.bars[0].columns.map((c) => c.notes[0].rightFinger).filter(Boolean)
    expect(rh).toEqual(['p', 'i', 'm', 'a', 'c'])
  })
})

describe('layout', () => {
  for (const file of ['samples/serenade.gp', 'samples/canon.gp5']) {
    it(`places every bar inside the canvas (${file})`, () => {
      const t = load(file)
      const systems = layoutTrack(t, measure)
      const seen = new Set<number>()
      for (const s of systems) {
        for (const b of s.bars) {
          seen.add(b.bar.number)
          expect(b.x + b.width).toBeLessThanOrEqual(CANVAS_W + 0.5)
          for (const c of b.columns) {
            expect(c.x).toBeGreaterThan(b.x)
            expect(c.x).toBeLessThan(b.x + b.width)
          }
        }
      }
      expect(seen.size).toBe(t.bars.length)
    })
  }
})
