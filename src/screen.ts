import { CANVAS_H, CANVAS_W, SYSTEM_H, type TabSystem } from './layout'
import { renderPageBadge, renderSystem, type Ctx2D } from './render'

export interface ScreenOptions {
  showFingering: boolean
  dimNext: boolean
  cursor?: { bar: number; tick: number }
}

/**
 * Compose one glasses screen: the current system on top and the next one
 * underneath (dimmed), so the eye can read ahead before the page turns.
 */
export function renderScreen(
  ctx: Ctx2D,
  systems: TabSystem[],
  index: number,
  stringNames: string[],
  opt: ScreenOptions,
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  const cur = systems[index]
  if (cur) {
    renderSystem(ctx, cur, stringNames, 0, {
      showFingering: opt.showFingering,
      dim: false,
      cursor: opt.cursor,
    })
  }
  const next = systems[index + 1]
  if (next) {
    renderSystem(ctx, next, stringNames, SYSTEM_H, {
      showFingering: opt.showFingering,
      dim: opt.dimNext,
    })
  }
  renderPageBadge(ctx, `${index + 1}/${systems.length}`)
}

/** 2×2 grid of 288×144 image containers covering the 576×288 canvas. */
export const TILES = [
  { id: 2, name: 'tl', x: 0, y: 0 },
  { id: 3, name: 'tr', x: 288, y: 0 },
  { id: 4, name: 'bl', x: 0, y: 144 },
  { id: 5, name: 'br', x: 288, y: 144 },
] as const
export const TILE_W = 288
export const TILE_H = 144
