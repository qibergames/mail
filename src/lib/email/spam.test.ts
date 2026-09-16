import { describe, expect, test } from 'bun:test'
import { classifySpam, needsSecondOpinion } from './spam'
import type { SpamSignals } from './spam'

const hostedDomains = ['qibergames.com', 'minecraft.hu']
const noHistory = { spam: 0, kept: 0 }

function signals(overrides: Partial<SpamSignals> & Pick<SpamSignals, 'headers'>): SpamSignals {
  return { envelopeTo: 'info@minecraft.hu', from: 'someone@example.com', recipients: ['info@minecraft.hu'], hostedDomains, senderDomainHistory: noHistory, ...overrides }
}

describe('classifySpam', () => {
  test('sends unsigned bulk mail addressed to a stranger to spam', () => {
    const verdict = classifySpam(signals({
      from: 'icmiydw@fernaderos.de',
      recipients: ['asztalos.gabor@mile-kft.hu'],
      headers: [
        { key: 'authentication-results', value: 'mx.cloudflare.net; dmarc=pass header.from=fernaderos.de policy.dmarc=none; spf=none (mx.cloudflare.net: no SPF records found for postmaster@mail.fernaderos.de) smtp.helo=mail.fernaderos.de; spf=pass (mx.cloudflare.net: domain of icmiydw@fernaderos.de designates 217.79.180.178 as permitted sender) smtp.mailfrom=icmiydw@fernaderos.de; arc=none' },
        { key: 'x-cf-spamh-score', value: '1' },
      ],
    }))
    expect(verdict).toEqual({ spam: true, score: 6, reasons: ['unsigned', 'not-addressed', 'cloudflare-1'] })
  })

  test('catches extortion mail that spoofs a hosted domain', () => {
    const verdict = classifySpam(signals({
      envelopeTo: 'finance@qibergames.com',
      from: 'finance@qibergames.com',
      recipients: ['finance@qibergames.com'],
      headers: [
        { key: 'authentication-results', value: 'mx.cloudflare.net; dmarc=none header.from=qibergames.com policy.dmarc=none; spf=temperror (mx.cloudflare.net: temporary dns error validating postmaster@[46.251.194.107]) smtp.helo=[46.251.194.107]; spf=softfail (mx.cloudflare.net: domain of finance@qibergames.com reports soft fail for 46.251.194.107) smtp.mailfrom=finance@qibergames.com; arc=none' },
        { key: 'x-cf-spamh-score', value: '2' },
      ],
    }))
    expect(verdict.spam).toBe(true)
    expect(verdict.reasons).toEqual(['unsigned', 'spf-softfail', 'spoofed-hosted-domain', 'cloudflare-2'])
  })

  test('keeps DKIM-signed notifications even when the headers name a different recipient', () => {
    expect(classifySpam(signals({
      from: 'sc-noreply@google.com',
      recipients: ['info%minecraft.hu@gtempaccount.com'],
      headers: [
        { key: 'authentication-results', value: 'mx.cloudflare.net; dkim=pass header.d=google.com header.s=20251104 header.b=MtMchwis; dmarc=pass header.from=google.com policy.dmarc=reject; spf=pass (mx.cloudflare.net: domain of x@scoutcamp.bounces.google.com designates 2607:f8b0:4864:20::745 as permitted sender) smtp.mailfrom=x@scoutcamp.bounces.google.com; arc=none' },
        { key: 'x-cf-spamh-score', value: '0' },
      ],
    }))).toEqual({ spam: false, score: 1, reasons: ['not-addressed'] })
  })

  test('keeps signed mail from a hosted domain and unsigned mail with nothing else against it', () => {
    expect(classifySpam(signals({
      from: 'finance@qibergames.com',
      headers: [{ key: 'authentication-results', value: 'mx.cloudflare.net; dkim=pass header.d=qibergames.com header.s=cf; spf=pass smtp.mailfrom=bounce@cloudflare-email.net' }],
    })).spam).toBe(false)
    expect(classifySpam(signals({
      headers: [{ key: 'authentication-results', value: 'mx.example.net; spf=pass smtp.mailfrom=someone@example.com' }, { key: 'x-cf-spamh-score', value: '2' }],
    }))).toEqual({ spam: false, score: 4, reasons: ['unsigned', 'cloudflare-2'] })
  })

  test('a domain the user keeps reporting tips unsigned mail over the threshold', () => {
    const headers = [{ key: 'authentication-results', value: 'mx.cloudflare.net; dmarc=pass header.from=fernaderos.de; spf=pass smtp.mailfrom=ujzozvm@fernaderos.de' }, { key: 'x-cf-spamh-score', value: '1' }]
    expect(classifySpam(signals({ from: 'ujzozvm@fernaderos.de', headers })).spam).toBe(false)
    expect(classifySpam(signals({ from: 'ujzozvm@fernaderos.de', headers, senderDomainHistory: { spam: 8, kept: 1 } }))).toEqual({ spam: true, score: 6, reasons: ['unsigned', 'cloudflare-1', 'reported-domain'] })
    expect(classifySpam(signals({ from: 'ujzozvm@fernaderos.de', headers, senderDomainHistory: { spam: 2, kept: 5 } })).spam).toBe(false)
  })

  test('asks for a second opinion only on unsigned mail below the threshold, and a confident AI verdict tips it', () => {
    const headers = [{ key: 'authentication-results', value: 'mx.cloudflare.net; dmarc=pass header.from=fernaderos.de; spf=pass smtp.mailfrom=ujzozvm@fernaderos.de' }, { key: 'x-cf-spamh-score', value: '1' }]
    const unsigned = classifySpam(signals({ from: 'ujzozvm@fernaderos.de', headers }))
    expect(needsSecondOpinion(unsigned)).toBe(true)
    expect(classifySpam(signals({ from: 'ujzozvm@fernaderos.de', headers, aiFlagged: true }))).toEqual({ spam: true, score: 6, reasons: ['unsigned', 'cloudflare-1', 'ai-spam'] })
    const signed = classifySpam(signals({ headers: [{ key: 'authentication-results', value: 'mx.cloudflare.net; dkim=pass header.d=example.com' }] }))
    expect(needsSecondOpinion(signed)).toBe(false)
  })
})
