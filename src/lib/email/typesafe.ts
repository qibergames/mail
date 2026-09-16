import type { AppDatabase } from '@/db'
import { reserveAiBudget } from './spam-ai'

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const MODEL = 'jev-latest'
/** Every inbound message asks one question set, so the cap is per message rather than per borderline case. */
export const TYPESAFE_DAILY_LIMIT = 500
const BODY_CHARS = 2000
const TIMEOUT_MS = 8000

export type MailCategory = 'primary' | 'promotions' | 'updates' | 'social' | 'forums'
export const MAIL_CATEGORIES: Array<MailCategory> = ['primary', 'promotions', 'updates', 'social', 'forums']

export type ChoiceAnswer = { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
export type ScoreAnswer = { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number }
export type NoulAnswer = { type: 'noul'; noul: number }
export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer
export type Answers = Record<string, Answer | undefined>

export type MailState = {
  from: string
  to: string
  subject: string | null
  body: string
  /** Codes and dates the parser already found, so the model selects rather than transcribes. */
  candidateCodes?: Array<string>
}

export type MailJudgment = {
  category: MailCategory | null
  categoryConfidence: number
  /** 0 routine, 1 worth attention, 2 time-critical; between levels is meaningful. */
  importance: number | null
  unsolicited: number | null
  phishing: number | null
  expectsReply: number | null
  meeting: number | null
  loginCode: string | null
}

// Speculative fan-out: every question is evaluated in parallel for one price in latency, and code below
// keeps only what applies. Instructions never take orders from the message, which is untrusted content.
function questions(state: MailState) {
  const codes = state.candidateCodes ?? []
  return {
    category: {
      type: 'choice',
      instructions: 'Which inbox category does this email belong to? Judge what the message is for, not who sent it.',
      criteria: {
        primary: 'Written by a person to this recipient, or a reply in a conversation they take part in',
        promotions: 'Marketing: offers, discounts, product announcements, sales campaigns',
        updates: 'Automated but expected: receipts, invoices, confirmations, security alerts, shipping, service notices',
        social: 'Activity from a social network, community platform or game service the recipient uses',
        forums: 'Mailing lists, discussion groups and newsletters the recipient subscribed to',
      },
    },
    importance: {
      type: 'score',
      instructions: 'How much does this email need the recipient\'s attention soon?',
      criteria: [
        'Routine; nothing is expected of the recipient',
        'Worth attention; a person writes to them, or something needs a decision eventually',
        'Time-critical; money, access, a deadline or a failure is at stake',
      ],
    },
    unsolicited: {
      type: 'noul',
      instructions: 'Is this unsolicited bulk mail, a scam, phishing or an extortion attempt?',
      criteria: {
        true: 'Advertising to a stranger, a fraud attempt, or a threat demanding payment',
        false: 'Mail the recipient would expect: personal mail, a service they use, a list they joined',
      },
    },
    phishing: {
      type: 'noul',
      instructions: 'Does this email pressure the reader into giving up credentials, payment details or an urgent transfer while claiming to be a company or person the reader trusts?',
    },
    expects_reply: {
      type: 'noul',
      instructions: 'Does the sender expect a written reply from the recipient?',
    },
    meeting: {
      type: 'noul',
      instructions: 'Does this email propose or confirm a specific appointment with a date and time?',
    },
    ...(codes.length
      ? {
          login_code: {
            type: 'choice',
            instructions: 'Which of these candidates is the one-time login or verification code the recipient is meant to enter? Reference `.candidate_codes`.',
            criteria: { ...Object.fromEntries(codes.map((code) => [code, `The code ${code}`])), none: 'None of them is a login or verification code' },
          },
        }
      : {}),
  }
}

const noul = (answer: Answer | undefined) => answer?.type === 'noul' ? answer.noul : null

/**
 * One request per inbound message, answering everything the mailbox wants to know about it. Returns null
 * when the key is missing or the call fails, so mail is always delivered on the transport signals alone.
 */
export async function askJudgment(env: CloudflareEnv, db: AppDatabase, state: unknown, asked: Record<string, unknown>): Promise<Answers | null> {
  if (!env.TYPESAFE_API_KEY) return null
  if (!(await env.AI_JUDGMENT_RATE_LIMIT.limit({ key: 'mail' })).success) return null
  if (!(await reserveAiBudget(db, 'typesafe', TYPESAFE_DAILY_LIMIT))) return null
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ model: MODEL, state, questions: asked }),
    })
    if (!response.ok) throw new Error(`TypeSafe responded ${response.status}: ${(await response.text()).slice(0, 200)}`)
    return (await response.json<{ answers?: Answers }>()).answers ?? {}
  } catch (error) {
    console.error('TypeSafe judgment failed', error)
    return null
  }
}

export async function judgeMail(env: CloudflareEnv, db: AppDatabase, state: MailState): Promise<MailJudgment | null> {
  const answers = await askJudgment(env, db, {
    email: { from: state.from, to: state.to, subject: state.subject ?? '', body: state.body.slice(0, BODY_CHARS) },
    ...(state.candidateCodes?.length ? { candidate_codes: state.candidateCodes } : {}),
  }, questions(state))
  if (!answers) return null
  const category = answers.category
  const importance = answers.importance
  const code = answers.login_code
  return {
    category: category?.type === 'choice' && MAIL_CATEGORIES.includes(category.choice as MailCategory) ? category.choice as MailCategory : null,
    categoryConfidence: category?.type === 'choice' ? category.confidence : 0,
    importance: importance?.type === 'score' ? importance.score : null,
    unsolicited: noul(answers.unsolicited),
    phishing: noul(answers.phishing),
    expectsReply: noul(answers.expects_reply),
    meeting: noul(answers.meeting),
    loginCode: code?.type === 'choice' && code.choice !== 'none' && code.confidence >= 0.6 ? code.choice : null,
  }
}

const DATE_LIKE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-.]\d{1,2}[-.]\d{2,4})$/

/** Digit groups a one-time code could plausibly be; the model picks which one it is. */
export function candidateCodes(text: string) {
  const matches = text.match(/(?<![\w-])\d[\d\s-]{3,10}\d(?![\w-])/g) ?? []
  return [...new Set(matches
    .filter((match) => !DATE_LIKE.test(match))
    .map((match) => match.replace(/[\s-]/g, ''))
    .filter((code) => code.length >= 4 && code.length <= 8))].slice(0, 6)
}
