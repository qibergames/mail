import { describe, expect, mock, test } from 'bun:test'
import { AI_SPAM_MODEL, isConfidentSpam, judgeSpamWithAi, parseAiVerdict } from './spam-ai'

const email = { from: 'ujzozvm@fernaderos.de', to: 'info@minecraft.hu', subject: 'Nem segítenek már a hagyományos talpbetétek?', text: 'Próbálja ki most 70% kedvezménnyel! '.repeat(100) }
const reply = (content: string) => ({ choices: [{ message: { content } }] })

function gate(overrides: { allowed?: boolean; budget?: boolean; run?: () => Promise<unknown> } = {}) {
  const run = mock(overrides.run ?? (async () => reply('{"spam":true,"confidence":0.95}')))
  const reserveBudget = mock(async () => overrides.budget ?? true)
  return { run, reserveBudget, gate: { ai: { run } as unknown as Ai, rateLimit: { limit: async () => ({ success: overrides.allowed ?? true }) }, reserveBudget } }
}

describe('judgeSpamWithAi', () => {
  test('asks the model with a truncated body and parses its JSON verdict', async () => {
    const { gate: g, run } = gate()
    expect(await judgeSpamWithAi(g, email)).toEqual({ spam: true, confidence: 0.95 })
    const [model, inputs] = run.mock.calls[0] as unknown as [string, { messages: Array<{ content: string }> }]
    expect(model).toBe(AI_SPAM_MODEL)
    expect(inputs.messages[1].content.length).toBeLessThan(1700)
  })

  test('skips the model when rate limited or over the daily budget', async () => {
    const limited = gate({ allowed: false })
    expect(await judgeSpamWithAi(limited.gate, email)).toBeNull()
    expect(limited.reserveBudget).not.toHaveBeenCalled()
    expect(limited.run).not.toHaveBeenCalled()
    const broke = gate({ budget: false })
    expect(await judgeSpamWithAi(broke.gate, email)).toBeNull()
    expect(broke.run).not.toHaveBeenCalled()
  })

  test('a failing or rambling model never blocks delivery', async () => {
    expect(await judgeSpamWithAi(gate({ run: async () => { throw new Error('3040: capacity') } }).gate, email)).toBeNull()
    expect(await judgeSpamWithAi(gate({ run: async () => reply('Yes, this looks like spam.') }).gate, email)).toBeNull()
  })
})

test('only confident spam verdicts count', () => {
  expect(parseAiVerdict('{"spam":true,"confidence":7}')).toEqual({ spam: true, confidence: 1 })
  expect(parseAiVerdict({ spam: 'yes', confidence: 1 })).toBeNull()
  expect(isConfidentSpam({ spam: true, confidence: 0.8 })).toBe(true)
  expect(isConfidentSpam({ spam: true, confidence: 0.6 })).toBe(false)
  expect(isConfidentSpam({ spam: false, confidence: 1 })).toBe(false)
  expect(isConfidentSpam(null)).toBe(false)
})
