import type { AppDatabase } from '@/db'
import { askJudgment } from './typesafe'

export type ProposedEvent = { title: string; startsAt: Date; endsAt: Date; location: string; source: 'invitation' | 'text' }

const HOUR = 3_600_000

/** Unfolds an iCalendar body and reads the first event out of it. */
export function eventFromIcs(ics: string, fallbackTitle: string): ProposedEvent | null {
  const lines = ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const field = (name: string) => lines.find((line) => line.toUpperCase().startsWith(name))?.split(':').slice(1).join(':').trim()
  const start = icsDate(field('DTSTART'))
  if (!start) return null
  const end = icsDate(field('DTEND'))
  return {
    title: field('SUMMARY') || fallbackTitle,
    startsAt: start,
    endsAt: end && end > start ? end : new Date(start.getTime() + HOUR),
    location: field('LOCATION') ?? '',
    source: 'invitation',
  }
}

function icsDate(value: string | undefined) {
  const match = value?.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/)
  if (!match) return null
  const [, year, month, day, hour = '0', minute = '0', second = '0', zulu] = match
  const parts = [year, month, day, hour, minute, second].map(Number) as [number, number, number, number, number, number]
  const time = zulu || !match[4]
    ? Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])
    : new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).getTime()
  return Number.isNaN(time) ? null : new Date(time)
}

/**
 * Moments the message could be pointing at: an explicit date, optionally with the time that follows it.
 * The model picks which one is the appointment, so nothing is invented.
 */
export function candidateMoments(text: string) {
  const dates = [...text.matchAll(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?|(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/g)]
  return [...new Set(dates.flatMap((match) => {
    const [year, month, day] = match[1] ? [match[1], match[2], match[3]] : [match[6], match[5], match[4]]
    const iso = `${year}-${String(Number(month)).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`
    if (Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return []
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40)
    const times = [...after.matchAll(/(?<![\d:])([01]?\d|2[0-3])[:.]([0-5]\d)/g)].slice(0, 2)
    return times.length ? times.map((time) => `${iso}T${time[1].padStart(2, '0')}:${time[2]}`) : [`${iso}T09:00`]
  }))].slice(0, 8)
}

/** The appointment a message proposes, from its invitation attachment or, failing that, from its text. */
export async function proposeEvent(
  env: CloudflareEnv,
  db: AppDatabase,
  message: { subject: string | null; text: string; ics?: string | null },
): Promise<ProposedEvent | null> {
  if (message.ics) {
    const invitation = eventFromIcs(message.ics, message.subject || 'Meeting')
    if (invitation) return invitation
  }
  const moments = candidateMoments(message.text)
  if (!moments.length) return null
  const answers = await askJudgment(env, db, { email: { subject: message.subject ?? '', body: message.text.slice(0, 2000) }, candidate_moments: moments }, {
    moment: {
      type: 'choice',
      instructions: 'Which candidate in `.candidate_moments` is when the appointment this email proposes starts?',
      criteria: { ...Object.fromEntries(moments.map((moment) => [moment, `The appointment starts at ${moment}`])), none: 'The email does not propose an appointment' },
    },
  })
  const answer = answers?.moment
  if (answer?.type !== 'choice' || answer.choice === 'none' || answer.confidence < 0.5) return null
  const startsAt = new Date(`${answer.choice}:00`)
  if (Number.isNaN(startsAt.getTime())) return null
  return { title: message.subject || 'Meeting', startsAt, endsAt: new Date(startsAt.getTime() + HOUR), location: '', source: 'text' }
}
