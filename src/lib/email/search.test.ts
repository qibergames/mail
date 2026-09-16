import { afterEach, expect, mock, test } from 'bun:test'
import type { AppDatabase } from '@/db'
import { isPhrase, rerankMessages, searchTerms } from './search'

const db = { insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [{ calls: 1 }] }) }) }) } as unknown as AppDatabase
const env = { TYPESAFE_API_KEY: 'key', AI_JUDGMENT_RATE_LIMIT: { limit: async () => ({ success: true }) } } as unknown as CloudflareEnv
const candidate = (id: string, subject: string) => ({ id, fromAddr: 'a@example.com', toAddr: 'me@example.com', subject, snippet: null })
const rows = [candidate('m1', 'Lunch on Friday'), candidate('m2', 'Your invoice is overdue'), candidate('m3', 'Weekly newsletter')]

const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })
const stub = (answers: Record<string, unknown>) => { globalThis.fetch = mock(async () => Response.json({ answers })) as unknown as typeof fetch }

test('a single word is a lookup, a phrase is a question', () => {
  expect(isPhrase('invoice')).toBe(false)
  expect(isPhrase('  unpaid invoice ')).toBe(true)
  expect(searchTerms('what did we agree about the invoice?')).toEqual(['what', 'did', 'agree', 'about', 'the', 'invoice'])
})

test('orders candidates by how well they answer the query', async () => {
  stub({ c0: { type: 'noul', noul: 0.05 }, c1: { type: 'noul', noul: 0.93 }, c2: { type: 'noul', noul: 0.4 } })
  const ranked = await rerankMessages(env, db, 'unpaid invoice', rows)
  expect(ranked?.map((row) => row.id)).toEqual(['m2', 'm3', 'm1'])
})

test('keeps the database order when nothing was judged', async () => {
  stub({})
  expect(await rerankMessages(env, db, 'unpaid invoice', rows)).toBeNull()
  globalThis.fetch = mock(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
  expect(await rerankMessages(env, db, 'unpaid invoice', rows)).toBeNull()
  expect(await rerankMessages(env, db, 'unpaid invoice', rows.slice(0, 1))).toBeNull()
})
