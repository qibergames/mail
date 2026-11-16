import { describe, expect, test } from 'bun:test'
import { normalizeLocalPart, parseAddress } from './address'
import { copyForwardRule, matchesRule } from './routing'

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

  test('forwards a copy of mail for an address that has its own mailbox', () => {
    const rule = { action: 'forward' as const, forwardTo: 'intake@example.net', keepCopy: true, pattern: 'support@example.com', matchValue: 'support@example.com', matchField: 'email' as const, matchOperator: 'contains' as const }
    expect(copyForwardRule([rule], 'support@example.com')).toBe(rule)
    expect(copyForwardRule([rule], 'info@example.com')).toBeUndefined()
    expect(copyForwardRule([{ ...rule, keepCopy: false }], 'support@example.com')).toBeUndefined()
    expect(copyForwardRule([{ ...rule, pattern: '*', matchValue: '*' }], 'support@example.com')).toBeUndefined()
    expect(copyForwardRule([{ ...rule, action: 'store' as const }], 'support@example.com')).toBeUndefined()
  })
})
