import { describe, expect, test } from 'bun:test'
import { isPublicHttpsUrl } from './public-url'

describe('outbound endpoint validation', () => {
  test('allows public HTTPS and rejects credentials, plaintext and private targets', () => {
    expect(isPublicHttpsUrl('https://push.example.com/path')).toBe(true)
    for (const url of ['http://example.com', 'https://a:b@example.com', 'https://localhost/x', 'https://127.0.0.1', 'https://10.0.0.1', 'https://192.168.1.1', 'https://[::1]']) expect(isPublicHttpsUrl(url)).toBe(false)
  })
})
