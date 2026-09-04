import { describe, expect, test } from 'bun:test'
import { readCookie, resolveLocale } from './locale'

describe('locale', () => {
  test('prefers a saved locale, then Accept-Language, then Hungarian', () => {
    expect(resolveLocale('en', 'hu-HU,hu;q=0.9')).toBe('en')
    expect(resolveLocale(null, 'en-US,en;q=0.9')).toBe('en')
    expect(resolveLocale(null, 'de-DE,de;q=0.9')).toBe('hu')
  })

  test('reads encoded cookie values', () => {
    expect(readCookie('a=1; qibermail-locale=en', 'qibermail-locale')).toBe('en')
  })
})
