import { afterEach, expect, mock, test } from 'bun:test'
import type { AppDatabase } from '@/db'
import { candidateValues, draftRule } from './rule-draft'

const db = { insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [{ calls: 1 }] }) }) }) } as unknown as AppDatabase
const env = { TYPESAFE_API_KEY: 'key', AI_JUDGMENT_RATE_LIMIT: { limit: async () => ({ success: true }) } } as unknown as CloudflareEnv
const folders = [{ id: 'fld_1', name: 'Accounting' }, { id: 'fld_2', name: 'Newsletters' }]
const choice = (value: string, confidence = 0.9) => ({ type: 'choice', choice: value, probabilities: {}, confidence })

const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })
const stub = (answers: Record<string, unknown>) => { globalThis.fetch = mock(async () => Response.json({ answers })) as unknown as typeof fetch }

test('takes the values to match on from the sentence itself', () => {
  expect(candidateValues('file receipts from receipts@stripe.com into Accounting')).toContain('receipts@stripe.com')
  expect(candidateValues('mark anything with “Newsletter” in the subject as read')).toContain('Newsletter')
  expect(candidateValues('do it')).toEqual([])
})

test('assembles a reviewable rule from the selected answers', async () => {
  stub({
    match_field: choice('sender'),
    match_operator: choice('contains'),
    action: choice('store'),
    match_value: choice('receipts@stripe.com'),
    folder: choice('Accounting'),
  })
  expect(await draftRule(env, db, 'file receipts from receipts@stripe.com into Accounting', folders)).toEqual({
    matchField: 'sender',
    matchOperator: 'contains',
    matchValue: 'receipts@stripe.com',
    action: 'store',
    folderId: 'fld_1',
  })
})

test('drops the folder when the rule does not file anything', async () => {
  stub({ match_field: choice('sender'), match_operator: choice('ends_with'), action: choice('spam'), match_value: choice('weblinks.host'), folder: choice('Accounting') })
  const draft = await draftRule(env, db, 'treat mail from weblinks.host as spam', folders)
  expect(draft).toMatchObject({ action: 'spam', folderId: null, matchValue: 'weblinks.host' })
})

test('returns nothing when the model is unsure, so the form stays empty rather than wrong', async () => {
  stub({ match_field: choice('sender', 0.2), match_operator: choice('contains'), action: choice('store'), match_value: choice('stripe.com') })
  expect(await draftRule(env, db, 'something about stripe.com maybe', folders)).toBeNull()
  stub({ match_field: choice('sender'), match_operator: choice('contains'), action: choice('store'), match_value: choice('invented-value') })
  expect(await draftRule(env, db, 'file mail from stripe.com', folders)).toBeNull()
})
