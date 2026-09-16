import { afterEach, describe, expect, mock, test } from 'bun:test'
import type { AppDatabase } from '@/db'
import { candidateCodes, judgeMail } from './typesafe'

const state = { from: 'noreply@shop.app', to: 'info@minecraft.hu', subject: '529527 is your Shop sign-in code', body: 'Valid for the next 10 minutes' }
const budgeted = { insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [{ calls: 1 }] }) }) }) } as unknown as AppDatabase
const exhausted = { insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [] }) }) }) } as unknown as AppDatabase

function env(overrides: { key?: string | undefined; allowed?: boolean } = {}) {
  return {
    TYPESAFE_API_KEY: 'key' in overrides ? overrides.key : 'ts-test-key',
    AI_JUDGMENT_RATE_LIMIT: { limit: async () => ({ success: overrides.allowed ?? true }) },
  } as unknown as CloudflareEnv
}

const answers = {
  category: { type: 'choice', choice: 'updates', probabilities: { updates: 0.9, primary: 0.1 }, confidence: 0.88 },
  importance: { type: 'score', score: 1.4, legend: {}, probabilities: {}, confidence: 0.7 },
  unsolicited: { type: 'noul', noul: 0.02 },
  phishing: { type: 'noul', noul: 0.05 },
  expects_reply: { type: 'noul', noul: 0.01 },
  meeting: { type: 'noul', noul: 0.0 },
  login_code: { type: 'choice', choice: '529527', probabilities: { '529527': 0.95, none: 0.05 }, confidence: 0.94 },
}

const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })

function stubFetch(response: Response) {
  const call = mock(async () => response)
  globalThis.fetch = call as unknown as typeof fetch
  return call
}

describe('judgeMail', () => {
  test('asks every question in one request and returns the typed answers', async () => {
    const call = stubFetch(Response.json({ answers }))
    expect(await judgeMail(env(), budgeted, { ...state, candidateCodes: ['529527'] })).toEqual({
      category: 'updates',
      categoryConfidence: 0.88,
      importance: 1.4,
      unsolicited: 0.02,
      phishing: 0.05,
      expectsReply: 0.01,
      meeting: 0,
      loginCode: '529527',
    })
    const body = JSON.parse((call.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { model: string; questions: Record<string, unknown> }
    expect(body.model).toBe('jev-latest')
    expect(Object.keys(body.questions)).toEqual(['category', 'importance', 'unsolicited', 'phishing', 'expects_reply', 'meeting', 'login_code'])
  })

  test('leaves out the code question when the parser found no candidate', async () => {
    const call = stubFetch(Response.json({ answers }))
    const judgment = await judgeMail(env(), budgeted, state)
    const body = JSON.parse((call.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { questions: Record<string, unknown> }
    expect(body.questions.login_code).toBeUndefined()
    // The model still answers it in this stub; without candidates the answer is not trusted either way.
    expect(judgment?.category).toBe('updates')
  })

  test('skips the call without a key, over the rate limit or over the daily budget', async () => {
    const call = stubFetch(Response.json({ answers }))
    expect(await judgeMail(env({ key: undefined }), budgeted, state)).toBeNull()
    expect(await judgeMail(env({ allowed: false }), budgeted, state)).toBeNull()
    expect(await judgeMail(env(), exhausted, state)).toBeNull()
    expect(call).not.toHaveBeenCalled()
  })

  test('a rejected or unreadable response never blocks delivery', async () => {
    stubFetch(new Response('rate limited', { status: 429 }))
    expect(await judgeMail(env(), budgeted, state)).toBeNull()
    stubFetch(new Response('<html>', { status: 200 }))
    expect(await judgeMail(env(), budgeted, state)).toBeNull()
  })

  test('ignores an unknown category and an unsure code', async () => {
    stubFetch(Response.json({ answers: {
      ...answers,
      category: { type: 'choice', choice: 'newsletter', probabilities: {}, confidence: 0.9 },
      login_code: { type: 'choice', choice: '529527', probabilities: {}, confidence: 0.4 },
    } }))
    const judgment = await judgeMail(env(), budgeted, state)
    expect(judgment?.category).toBeNull()
    expect(judgment?.loginCode).toBeNull()
  })
})

test('code candidates are the digit groups a one-time code could be', () => {
  expect(candidateCodes('529527 is your Shop sign-in code')).toEqual(['529527'])
  expect(candidateCodes('Use 123-456 or 78 90 12 to sign in')).toEqual(['123456', '789012'])
  expect(candidateCodes('Order #A-104 total 42 EUR on 2026-09-16')).toEqual([])
})
