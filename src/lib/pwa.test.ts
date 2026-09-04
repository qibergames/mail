import { describe, expect, test } from 'bun:test'

describe('PWA metadata', () => {
  test('is standalone and ships install icons plus push handlers', async () => {
    const manifest = await Bun.file('public/manifest.webmanifest').json()
    expect(manifest.name).toBe('QiberMail')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.some((icon: { sizes: string; purpose: string }) => icon.sizes === '192x192' && icon.purpose === 'any')).toBe(true)
    expect(manifest.icons.some((icon: { sizes: string; purpose: string }) => icon.sizes === '512x512' && icon.purpose === 'maskable')).toBe(true)
    const worker = await Bun.file('public/sw.js').text()
    expect(worker).toContain("addEventListener('push'")
    expect(worker).toContain("addEventListener('notificationclick'")
  })
})
