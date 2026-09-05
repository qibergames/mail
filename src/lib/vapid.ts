/** Accepts the many ways a VAPID key ends up in a secret (quotes, newlines, standard base64, padding) and yields base64url. */
export function normalizeVapidKey(raw: string | undefined | null, expectedBytes: 65 | 32): { key: string | null; error: string | null } {
  const cleaned = (raw ?? '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (!cleaned) return { key: null, error: 'missing' }
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) return { key: null, error: 'not base64url' }
  const bytes = decodeBase64Url(cleaned)
  if (!bytes) return { key: null, error: 'not base64url' }
  if (bytes.length !== expectedBytes) return { key: null, error: `expected ${expectedBytes} bytes, got ${bytes.length}` }
  if (expectedBytes === 65 && bytes[0] !== 0x04) return { key: null, error: 'public key must be an uncompressed P-256 point' }
  return { key: cleaned, error: null }
}

export function decodeBase64Url(value: string): Uint8Array | null {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  try {
    const binary = atob(padded)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}
