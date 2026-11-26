import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerUpgrade,
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
const WELCOME = 'Glass Tabs\n\nTelefondan bir tab dosyası seçin.\nOpen a tab file on your phone.'

function canvasPng(c: HTMLCanvasElement): Promise<number[]> {
  return new Promise((resolve, reject) =>
    c.toBlob(async (b) => {
      if (!b) return reject(new Error('toBlob failed'))
      resolve(Array.from(new Uint8Array(await b.arrayBuffer())))
    }, 'image/png'),
  )
}

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
  private mode: 'none' | 'text' | 'tab' = 'none'

  constructor(
    private onAction: (a: GlassesAction) => void,
    private log: (msg: string) => void = () => {},
  ) {
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
    if (!bridge) {
      this.log('bridge: bulunamadı (zaman aşımı)')
      return false
    }
    this.bridge = bridge
    this.log('bridge: hazır')

    // Start with a text-only page: it shows a welcome message and is the
    // simplest layout the host can accept. The image grid is built later.
    const raw = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [this.textContainer(WELCOME)],
      }),
    )
    const res = StartUpPageCreateResult.normalize(raw)
    this.log(`createStartUpPageContainer → ${raw} (${StartUpPageCreateResult[res] ?? res})`)
    if (res !== StartUpPageCreateResult.success) return false
    bridge.onEvenHubEvent((e) => this.handleEvent(e))
    this.mode = 'text'
    this.ready = true
    return true
  }

  private textContainer(content: string): TextContainerProperty {
    return new TextContainerProperty({
      containerID: EVT_ID,
      containerName: EVT_NAME,
      xPosition: 0,
      yPosition: 0,
      width: CANVAS_W,
      height: CANVAS_H,
      borderWidth: 0,
      paddingLength: 0,
      content,
      isEventCapture: 1,
    })
  }

  /** Show a plain text message on the glasses (switches back to the text page). */
  showMessage(text: string): Promise<void> {
    const job = this.queue.then(async () => {
      if (!this.bridge || !this.ready) return
      if (this.mode === 'text') {
        const ok = await this.bridge.textContainerUpgrade(
          new TextContainerUpgrade({ containerID: EVT_ID, containerName: EVT_NAME, content: text }),
        )
        this.log(`textContainerUpgrade → ${ok}`)
        return
      }
      const ok = await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({ containerTotalNum: 1, textObject: [this.textContainer(text)] }),
      )
      this.log(`rebuild(text) → ${ok}`)
      if (ok) this.mode = 'text'
    })
    this.queue = job.catch((err) => this.log(`hata: ${err}`))
    return this.queue
  }

  private async ensureTabPage(): Promise<boolean> {
    if (!this.bridge) return false
    if (this.mode === 'tab') return true
    const ok = await this.bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1 + TILES.length,
        textObject: [this.textContainer(' ')],
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
      }),
    )
    this.log(`rebuild(tab: 1 text + ${TILES.length} image) → ${ok}`)
    if (!ok) return false
    this.mode = 'tab'
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
        this.log('foreground')
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
    const job = this.queue.then(() => this.sendTiles(frame)).catch((err) => this.log(`hata: ${err}`))
    this.queue = job
    return job
  }

  private async sendTiles(frame: HTMLCanvasElement): Promise<void> {
    if (!this.bridge || !this.ready) return
    if (!(await this.ensureTabPage())) return
    const ctx = this.tileCanvas.getContext('2d')!
    for (const t of TILES) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, TILE_W, TILE_H)
      ctx.drawImage(frame, t.x, t.y, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H)
      const dataUrl = this.tileCanvas.toDataURL('image/png')
      if (this.tileHash.get(t.id) === dataUrl) continue
      const png = await canvasPng(this.tileCanvas)
      const t0 = performance.now()
      const raw = await this.bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: t.id, containerName: t.name, imageData: png }),
      )
      const res = ImageRawDataUpdateResult.normalize(raw)
      this.log(`image ${t.name} (${png.length} B) → ${res} ${Math.round(performance.now() - t0)} ms`)
      if (ImageRawDataUpdateResult.isSuccess(res)) {
        this.tileHash.set(t.id, dataUrl)
      } else {
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
