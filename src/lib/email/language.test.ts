import { describe, expect, test } from 'bun:test'
import { detectLanguage } from './language'

describe('detectLanguage', () => {
  test('recognizes short Hungarian messages', () => {
    expect(detectLanguage('Ez az első üzenet erről az email címről')).toBe('hu')
    expect(detectLanguage('Szia, holnap találkozunk?')).toBe('hu')
  })

  test('recognizes English messages', () => {
    expect(detectLanguage('Hi, thanks for the update. I will check it tomorrow.')).toBe('en')
  })

  test('ignores quoted reply text', () => {
    expect(detectLanguage('Thanks, that works for me.\n\n> Ez az első üzenet erről az email címről')).toBe('en')
  })

  test('stays silent when unsure', () => {
    expect(detectLanguage('ok')).toBeUndefined()
    expect(detectLanguage('')).toBeUndefined()
  })
})
