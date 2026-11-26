import type { Glasses } from './glasses'

const CHUNK = 200_000 // base64 chars per storage key
const MAX_FILE_BYTES = 2_000_000

/**
 * Persistent key/value storage. Uses the Even Hub bridge storage when the
 * glasses are connected (browser localStorage does not survive restarts in
 * the .ehpk WebView) and falls back to localStorage in a normal browser.
 */
export class Store {
  constructor(private glasses: Glasses) {}

  async init(): Promise<void> {
    /* reserved for pre-loading keys */
  }

  async get(key: string): Promise<string> {
    if (this.glasses.connected) return this.glasses.getItem(`gt:${key}`)
    try {
      return window.localStorage.getItem(`gt:${key}`) ?? ''
    } catch {
      return ''
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (this.glasses.connected) return this.glasses.setItem(`gt:${key}`, value)
    try {
      window.localStorage.setItem(`gt:${key}`, value)
    } catch {
      /* quota or disabled */
    }
  }

  async saveLastFile(name: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length > MAX_FILE_BYTES) return
    const b64 = toBase64(bytes)
    const parts = Math.ceil(b64.length / CHUNK)
    for (let i = 0; i < parts; i++) await this.set(`file:${i}`, b64.slice(i * CHUNK, (i + 1) * CHUNK))
    await this.set('file:meta', JSON.stringify({ name, parts }))
  }

  async loadLastFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
    try {
      const meta = await this.get('file:meta')
      if (!meta) return null
      const { name, parts } = JSON.parse(meta) as { name: string; parts: number }
      let b64 = ''
      for (let i = 0; i < parts; i++) b64 += await this.get(`file:${i}`)
      if (!b64) return null
      return { name, bytes: fromBase64(b64) }
    } catch {
      return null
    }
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
