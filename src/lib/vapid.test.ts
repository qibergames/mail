import { describe, expect, test } from 'bun:test'
import { normalizeVapidKey } from './vapid'

const point = new Uint8Array(65); point[0] = 0x04
const base64 = btoa(String.fromCharCode(...point))
const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('normalizeVapidKey', () => {
  test('accepts base64url, standard base64, quotes and whitespace', () => {
    expect(normalizeVapidKey(base64url, 65).key).toBe(base64url)
    expect(normalizeVapidKey(base64, 65).key).toBe(base64url)
    expect(normalizeVapidKey(`"${base64url}"\n`, 65).key).toBe(base64url)
  })
  test('rejects garbage, wrong length and compressed points', () => {
    expect(normalizeVapidKey('not a key!', 65).error).toBe('not base64url')
    expect(normalizeVapidKey(base64url.slice(0, 40), 65).error).toMatch(/expected 65 bytes/)
    const compressed = new Uint8Array(65); compressed[0] = 0x02
    expect(normalizeVapidKey(btoa(String.fromCharCode(...compressed)), 65).error).toMatch(/uncompressed/)
    expect(normalizeVapidKey('', 32).error).toBe('missing')
  })
})
