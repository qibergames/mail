import { describe, expect, test } from 'bun:test'
import { normalizeLocalPart, parseAddress } from './address'
import { matchesRule } from './routing'

describe('email routing', () => {
  test('normalizes tagged and dotted recipients', () => {
    expect(parseAddress('Name <First.Last+news@Example.com>')).toEqual({
      local: 'first.last+news',
      domain: 'example.com',
      address: 'first.last+news@example.com',
    })
    expect(normalizeLocalPart('first.last+news')).toBe('firstlast')
  })

  test('matches safe operators and contains invalid regex failures', () => {
    const base = { pattern: '', matchField: 'sender' as const, matchValue: 'alerts@example.com' }
    expect(matchesRule({ ...base, matchOperator: 'exact' }, { to: 'me@example.com', from: 'alerts@example.com' })).toBe(true)
    expect(matchesRule({ ...base, matchOperator: 'regex', matchValue: '[' }, { to: 'me@example.com', from: 'alerts@example.com' })).toBe(false)
    expect(matchesRule({ ...base, matchOperator: 'contains', matchValue: '*' }, { to: 'me@example.com' })).toBe(true)
  })
})
