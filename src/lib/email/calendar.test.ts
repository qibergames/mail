import { afterEach, expect, mock, test } from 'bun:test'
import type { AppDatabase } from '@/db'
import { candidateMoments, eventFromIcs, proposeEvent } from './calendar'

const db = { insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [{ calls: 1 }] }) }) }) } as unknown as AppDatabase
const env = { TYPESAFE_API_KEY: 'key', AI_JUDGMENT_RATE_LIMIT: { limit: async () => ({ success: true }) } } as unknown as CloudflareEnv

const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Sprint review with the 
 platform team
DTSTART:20260918T140000Z
DTEND:20260918T150000Z
LOCATION:Meet: https://example.com/room
END:VEVENT
END:VCALENDAR`

const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })
const stub = (answers: Record<string, unknown>) => { globalThis.fetch = mock(async () => Response.json({ answers })) as unknown as typeof fetch }

test('reads an invitation, unfolding a wrapped line and keeping the colon in a value', () => {
  expect(eventFromIcs(ics, 'fallback')).toEqual({
    title: 'Sprint review with the platform team',
    startsAt: new Date('2026-09-18T14:00:00Z'),
    endsAt: new Date('2026-09-18T15:00:00Z'),
    location: 'Meet: https://example.com/room',
    source: 'invitation',
  })
  expect(eventFromIcs('BEGIN:VCALENDAR\nEND:VCALENDAR', 'fallback')).toBeNull()
})

test('an invitation without an end runs for an hour', () => {
  expect(eventFromIcs('DTSTART:20260918T140000Z\nSUMMARY:Call', 'fallback')?.endsAt).toEqual(new Date('2026-09-18T15:00:00Z'))
})

test('candidate moments pair a date with the times written after it', () => {
  expect(candidateMoments('Találkozzunk 2026.09.18. 14:00 vagy 16:30 között')).toEqual(['2026-09-18T14:00', '2026-09-18T16:30'])
  expect(candidateMoments('Deadline is 18/09/2026, no time given')).toEqual(['2026-09-18T09:00'])
  expect(candidateMoments('no dates here')).toEqual([])
})

test('an invitation wins over the text and needs no judgment', async () => {
  const call = mock(async () => Response.json({ answers: {} }))
  globalThis.fetch = call as unknown as typeof fetch
  const event = await proposeEvent(env, db, { subject: 'Invite', text: 'see 2026.09.20. 10:00', ics })
  expect(event?.source).toBe('invitation')
  expect(call).not.toHaveBeenCalled()
})

test('falls back to the moment the model selects, and proposes nothing when it is unsure', async () => {
  stub({ moment: { type: 'choice', choice: '2026-09-18T14:00', probabilities: {}, confidence: 0.9 } })
  const event = await proposeEvent(env, db, { subject: 'Coffee', text: 'Jó lenne 2026.09.18. 14:00-kor' })
  expect(event).toMatchObject({ title: 'Coffee', source: 'text', startsAt: new Date('2026-09-18T14:00:00') })
  stub({ moment: { type: 'choice', choice: 'none', probabilities: {}, confidence: 0.9 } })
  expect(await proposeEvent(env, db, { subject: 'Coffee', text: 'Jó lenne 2026.09.18. 14:00-kor' })).toBeNull()
  stub({ moment: { type: 'choice', choice: '2026-09-18T14:00', probabilities: {}, confidence: 0.3 } })
  expect(await proposeEvent(env, db, { subject: 'Coffee', text: 'Jó lenne 2026.09.18. 14:00-kor' })).toBeNull()
})
