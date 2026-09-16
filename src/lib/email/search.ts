import type { AppDatabase } from '@/db'
import { askJudgment } from './typesafe'

/** Enough candidates for the judgment to have something to choose from, few enough to stay one request. */
export const RERANK_LIMIT = 24
const KEEP_ABOVE = 0.15

export type SearchCandidate = { id: string; fromAddr: string; toAddr: string; subject: string | null; snippet: string | null }

/** A single word is a lookup and the database already answers it; a phrase is a question worth judging. */
export const isPhrase = (query: string) => /\s/.test(query.trim())

/** Words worth widening the candidate set with, so a phrase finds mail that no exact substring matches. */
export function searchTerms(query: string) {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}@._-]+/u).filter((word) => word.length >= 3))].slice(0, 8)
}

/**
 * Orders candidates by how well each answers the query. Returns null when no judgment was made, so the
 * caller keeps the database's own ordering.
 */
export async function rerankMessages<T extends SearchCandidate>(env: CloudflareEnv, db: AppDatabase, query: string, candidates: Array<T>): Promise<Array<T> | null> {
  const judged = candidates.slice(0, RERANK_LIMIT)
  if (judged.length < 2) return null
  const answers = await askJudgment(env, db, {
    query,
    candidates: judged.map((message, index) => ({ index, from: message.fromAddr, to: message.toAddr, subject: message.subject ?? '', preview: message.snippet ?? '' })),
  }, Object.fromEntries(judged.map((_, index) => [`c${index}`, {
    type: 'noul',
    instructions: `Does the email at \`.candidates[${index}]\` answer what the reader is looking for in \`.query\`?`,
  }])))
  if (!answers) return null

  const scored = judged.map((message, index) => {
    const answer = answers[`c${index}`]
    return { message, score: answer?.type === 'noul' ? answer.noul : 0 }
  })
  if (scored.every((item) => item.score === 0)) return null
  const relevant = scored.filter((item) => item.score > KEEP_ABOVE).sort((first, second) => second.score - first.score)
  // Everything the judgment dismissed still follows, in the order the database returned it.
  const dismissed = scored.filter((item) => item.score <= KEEP_ABOVE).map((item) => item.message)
  return [...relevant.map((item) => item.message), ...dismissed, ...candidates.slice(RERANK_LIMIT)]
}
