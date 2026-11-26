/**
 * Render a Guitar Pro file to PNG previews of what the glasses will show.
 *   npx tsx scripts/preview.ts <file.gp> [trackIndex] [outDir]
 */
import { createCanvas } from '@napi-rs/canvas'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CANVAS_H, CANVAS_W, layoutTrack } from '../src/layout'
import { makeMeasure, type Ctx2D } from '../src/render'
import { buildTrack, defaultTrackIndex, listTracks, loadScore } from '../src/score'
import { renderScreen } from '../src/screen'

const [file, trackArg, outDir = 'preview'] = process.argv.slice(2)
if (!file) throw new Error('usage: preview.ts <file> [track] [outDir]')

const score = loadScore(new Uint8Array(readFileSync(file)))
const tracks = listTracks(score)
const ti = trackArg !== undefined ? Number(trackArg) : defaultTrackIndex(tracks)
const track = buildTrack(score, ti)

const canvas = createCanvas(CANVAS_W, CANVAS_H)
const ctx = canvas.getContext('2d') as unknown as Ctx2D
const systems = layoutTrack(track, makeMeasure(ctx))
console.log(`${track.title} – ${track.trackName}: ${track.bars.length} bars → ${systems.length} systems`)

mkdirSync(outDir, { recursive: true })
const pages = Math.min(systems.length, 4)
for (let i = 0; i < pages; i++) {
  renderScreen(ctx, systems, i, track.stringNames, { showFingering: true, dimNext: true })
  // simulate the green micro-LED look for the preview
  const img = ctx as unknown as CanvasRenderingContext2D
  const data = img.getImageData(0, 0, CANVAS_W, CANVAS_H)
  for (let p = 0; p < data.data.length; p += 4) {
    const v = data.data[p]
    const q = Math.round(v / 17) * 17 // 4-bit
    data.data[p] = Math.round(q * 0.25)
    data.data[p + 1] = q
    data.data[p + 2] = Math.round(q * 0.35)
  }
  img.putImageData(data, 0, 0)
  const out = join(outDir, `page-${i + 1}.png`)
  writeFileSync(out, canvas.toBuffer('image/png'))
  console.log('wrote', out)
}
