import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { CANVAS_H, CANVAS_W } from './layout'
import { TILES, TILE_H, TILE_W } from './screen'

export type GlassesAction = 'next' | 'prev' | 'tap' | 'exit' | 'foreground'

const EVT_ID = 1
const EVT_NAME = 'evt'
const SWIPE_COOLDOWN_MS = 300

/**
 * Thin wrapper around the Even Hub bridge:
 *  - one full-screen text container behind everything that captures input
 *  - a 2×2 grid of 288×144 image containers showing the rendered tab
 */
export class Glasses {
  private bridge: EvenAppBridge | null = null
  private ready = false
  private lastSwipe = 0
  private queue: Promise<void> = Promise.resolve()
  private tileHash = new Map<number, string>()
  private tileCanvas: HTMLCanvasElement

  constructor(private onAction: (a: GlassesAction) => void) {
    this.tileCanvas = document.createElement('canvas')
    this.tileCanvas.width = TILE_W
    this.tileCanvas.height = TILE_H
  }

  get connected(): boolean {
    return this.ready
  }

  async connect(timeoutMs = 4000): Promise<boolean> {
    const bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ])
    if (!bridge) return false
    this.bridge = bridge

    const page = new CreateStartUpPageContainer({
      containerTotalNum: 1 + TILES.length,
      textObject: [
        new TextContainerProperty({
          containerID: EVT_ID,
          containerName: EVT_NAME,
          xPosition: 0,
          yPosition: 0,
          width: CANVAS_W,
          height: CANVAS_H,
          borderWidth: 0,
          paddingLength: 0,
          content: ' ',
          isEventCapture: 1,
        }),
      ],
      imageObject: TILES.map(
        (t) =>
          new ImageContainerProperty({
            containerID: t.id,
            containerName: t.name,
            xPosition: t.x,
            yPosition: t.y,
            width: TILE_W,
            height: TILE_H,
          }),
      ),
    })
    const res = await bridge.createStartUpPageContainer(page)
    if (res !== StartUpPageCreateResult.success) {
      console.error('createStartUpPageContainer failed', res)
      return false
    }
    bridge.onEvenHubEvent((e) => this.handleEvent(e))
    this.ready = true
    this.tileHash.clear()
    return true
  }

  private handleEvent(e: EvenHubEvent): void {
    const type = e.textEvent?.eventType ?? e.sysEvent?.eventType ?? e.listEvent?.eventType
    const hasInput = !!(e.textEvent || e.sysEvent || e.listEvent)
    if (!hasInput) return
    const now = Date.now()
    switch (type) {
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        if (now - this.lastSwipe < SWIPE_COOLDOWN_MS) return
        this.lastSwipe = now
        this.onAction('next')
        break
      case OsEventTypeList.SCROLL_TOP_EVENT:
        if (now - this.lastSwipe < SWIPE_COOLDOWN_MS) return
        this.lastSwipe = now
        this.onAction('prev')
        break
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        this.onAction('exit')
        break
      case OsEventTypeList.FOREGROUND_ENTER_EVENT:
        this.tileHash.clear()
        this.onAction('foreground')
        break
      case OsEventTypeList.CLICK_EVENT:
      case undefined: // SDK quirk: CLICK_EVENT (0) often arrives as undefined
        this.onAction('tap')
        break
      default:
        break
    }
  }

  /** Root-page double tap must open the host's exit dialogue (Even Hub review rule). */
  async exit(): Promise<void> {
    await this.bridge?.shutDownPageContainer(1)
  }

  /** Push a full 576×288 frame; only changed tiles are sent, strictly one at a time. */
  pushFrame(frame: HTMLCanvasElement): Promise<void> {
    const job = this.queue.then(() => this.sendTiles(frame)).catch((err) => console.error(err))
    this.queue = job
    return job
  }

  private async sendTiles(frame: HTMLCanvasElement): Promise<void> {
    if (!this.bridge || !this.ready) return
    const ctx = this.tileCanvas.getContext('2d')!
    for (const t of TILES) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, TILE_W, TILE_H)
      ctx.drawImage(frame, t.x, t.y, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H)
      const dataUrl = this.tileCanvas.toDataURL('image/png')
      if (this.tileHash.get(t.id) === dataUrl) continue
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const res = await this.bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: t.id, containerName: t.name, imageData: base64 }),
      )
      if (ImageRawDataUpdateResult.isSuccess(ImageRawDataUpdateResult.normalize(res))) {
        this.tileHash.set(t.id, dataUrl)
      } else {
        console.warn('tile update failed', t.name, res)
        this.tileHash.delete(t.id)
      }
    }
  }

  async getItem(key: string): Promise<string> {
    if (!this.bridge) return ''
    try {
      return (await this.bridge.getLocalStorage(key)) ?? ''
    } catch {
      return ''
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    if (!this.bridge) return
    try {
      await this.bridge.setLocalStorage(key, value)
    } catch {
      /* best effort */
    }
  }
}
