import { describe, expect, test } from 'bun:test'
import { mailStore, matchesView } from './mail-store'
import type { MessageSummary } from './mail-store'

function message(overrides: Partial<MessageSummary>): MessageSummary {
  return { id: 'm1', mailboxId: 'mbx', direction: 'inbound', folderId: null, fromAddr: 'a@example.com', toAddr: 'b@example.com', subject: 'Hi', snippet: null, status: 'received', read: false, starred: false, snoozedUntil: null, threadId: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...overrides }
}

describe('matchesView', () => {
  const now = '2026-09-05T00:00:00.000Z'
  test('inbox hides snoozed and non-received mail', () => {
    expect(matchesView(message({}), 'inbox', undefined, now)).toBe(true)
    expect(matchesView(message({ snoozedUntil: '2026-09-06T00:00:00.000Z' }), 'inbox', undefined, now)).toBe(false)
    expect(matchesView(message({ snoozedUntil: '2026-09-04T00:00:00.000Z' }), 'inbox', undefined, now)).toBe(true)
    expect(matchesView(message({ status: 'archived' }), 'inbox', undefined, now)).toBe(false)
  })
  test('folder view filters by folder, sent by direction and status', () => {
    expect(matchesView(message({ folderId: 'f1', status: 'received' }), 'inbox', 'f1', now)).toBe(true)
    expect(matchesView(message({ folderId: null }), 'inbox', 'f1', now)).toBe(false)
    expect(matchesView(message({ direction: 'outbound', status: 'sent' }), 'sent', undefined, now)).toBe(true)
    expect(matchesView(message({ direction: 'outbound', status: 'draft' }), 'sent', undefined, now)).toBe(false)
    expect(matchesView(message({ direction: 'outbound', status: 'draft' }), 'drafts', undefined, now)).toBe(true)
  })
})

describe('mailStore', () => {
  test('merges deltas, honours tombstones and applies optimistic updates', async () => {
    const calls: Array<string> = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.startsWith('/api/messages/sync')) {
        const since = new URL(url, 'https://x').searchParams.get('since')
        const payload = since
          ? { now: 200, messages: [message({ id: 'm1', read: true, updatedAt: '2026-09-02T00:00:00.000Z' })], deleted: ['m2'], full: false, truncated: false, mailboxIds: ['mbx'] }
          : { now: 100, messages: [message({ id: 'm1' }), message({ id: 'm2', createdAt: '2026-09-02T00:00:00.000Z' })], deleted: [], full: true, truncated: false, mailboxIds: ['mbx'] }
        return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(null, { status: 204 })
    }) as typeof fetch

    await mailStore.start()
    expect(mailStore.select('inbox', 'mbx').map((row) => row.id)).toEqual(['m2', 'm1'])

    await mailStore.update(['m2'], { starred: true })
    expect(mailStore.get('m2')?.starred).toBe(true)
    expect(calls).toContain('PATCH /api/messages/m2')

    await mailStore.sync()
    expect(mailStore.select('inbox', 'mbx').map((row) => row.id)).toEqual(['m1'])
    expect(mailStore.get('m1')?.read).toBe(true)
    expect(mailStore.select('starred', 'mbx')).toEqual([])
  })
})
