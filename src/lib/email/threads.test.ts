import { describe, expect, test } from 'bun:test'
import { groupThreads, normalizeSubject, parseMessageIds } from './threads'

const base = { threadId: null, read: true, starred: false }
const m = (id: string, overrides: Record<string, unknown>) => ({ id, subject: 'Teszt', fromAddr: 'a@example.com', toAddr: 'b@example.com', createdAt: `2026-09-05T00:0${id.length}:00.000Z`, ...base, ...overrides })

describe('normalizeSubject', () => {
  test('strips reply and forward prefixes in several languages', () => {
    expect(normalizeSubject('Re: Re: Teszt')).toBe('teszt')
    expect(normalizeSubject('Fwd: RE[2]: Hello  world')).toBe('hello world')
    expect(normalizeSubject('Vá: Teszt')).toBe('teszt')
    expect(normalizeSubject(null)).toBe('')
  })
  test('parses message id lists', () => {
    expect(parseMessageIds('<a@x> <b@y>')).toEqual(['a@x', 'b@y'])
  })
})

describe('groupThreads', () => {
  test('groups by threadId and merges subject matches with shared participants', () => {
    const rows = [
      m('1', { threadId: 't1', createdAt: '2026-09-05T00:01:00.000Z' }),
      m('2', { threadId: 't1', createdAt: '2026-09-05T00:02:00.000Z', read: false }),
      m('3', { subject: 'Re: Teszt', fromAddr: 'b@example.com', toAddr: 'a@example.com', createdAt: '2026-09-05T00:03:00.000Z' }),
      m('4', { subject: 'Teszt', fromAddr: 'stranger@example.org', toAddr: 'nobody@example.org', createdAt: '2026-09-05T00:04:00.000Z' }),
      m('5', { subject: 'Other', createdAt: '2026-09-05T00:00:00.000Z' }),
    ]
    const threads = groupThreads(rows)
    expect(threads.map((thread) => thread.messages.map((row) => row.id))).toEqual([['4'], ['1', '2', '3'], ['5']])
    expect(threads[1].unread).toBe(true)
    expect(threads[1].latest.id).toBe('3')
    expect(threads[1].count).toBe(3)
  })
})
