import { describe, expect, test } from 'bun:test'
import { isTheme, resolveTheme } from './theme'

describe('theme', () => {
  test('resolves explicit and system themes', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('system', true)).toBe('dark')
  })

  test('accepts only supported values', () => {
    expect(isTheme('system')).toBe(true)
    expect(isTheme('sepia')).toBe(false)
  })
})
