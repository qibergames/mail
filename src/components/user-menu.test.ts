import { describe, expect, test } from 'bun:test'
import { initialsOf } from './user-menu'

describe('user menu', () => {
  test('builds avatar initials from the name, falling back to the address', () => {
    expect(initialsOf('Román Benjámin', 'x@example.com')).toBe('RB')
    expect(initialsOf('  solo ', 'x@example.com')).toBe('S')
    expect(initialsOf(null, 'mail@example.com')).toBe('M')
    expect(initialsOf('', '')).toBe('?')
  })
})
