import { desc, eq } from 'drizzle-orm'
import { getDb } from '@/db'
import { queueFailures } from '@/db/schema'
import { handleEmailSendingEvent } from '@/lib/email/bounces'
import { isEmailSendingEvent } from '@/lib/email/delivery-report'
import { newId } from '@/lib/ids'

/** Consumer for the dead letter queue named in wrangler.jsonc. */
export const DEAD_LETTER_QUEUE = 'qibermail-dlq'

function kindOf(body: unknown) {
  const type = typeof body === 'object' && body !== null && 'type' in body ? (body as { type?: unknown }).type : undefined
  return typeof type === 'string' ? type : 'unknown'
}

/** Keeps a message that exhausted its retries instead of letting the queue drop it silently. */
export async function recordQueueFailure(env: CloudflareEnv, body: unknown, attempts: number) {
  const payload = JSON.stringify(body)
  // A raw email is already in R2, so the payload stays small; anything larger is not worth keeping whole.
  if (payload.length > 100_000) throw new Error(`Dead letter payload too large (${payload.length} bytes)`)
  await getDb(env.DB).insert(queueFailures).values({ id: newId('qfa'), kind: kindOf(body), payload, attempts })
  console.error('Queue message moved to the dead letter queue', { kind: kindOf(body), attempts })
}

export function listQueueFailures() {
  return getDb().select().from(queueFailures).orderBy(desc(queueFailures.createdAt)).limit(50)
}

export function deleteQueueFailure(id: string) {
  return getDb().delete(queueFailures).where(eq(queueFailures.id, id))
}

/**
 * Puts the message back on its queue, so the retry runs with the same code path as the original delivery.
 * Sending events have no producer binding, so those are handled here and now.
 */
export async function retryQueueFailure(env: CloudflareEnv, id: string) {
  const db = getDb(env.DB)
  const failure = (await db.select().from(queueFailures).where(eq(queueFailures.id, id)).limit(1)).at(0)
  if (!failure) return false
  const body = JSON.parse(failure.payload) as unknown
  if (isEmailSendingEvent(body)) await handleEmailSendingEvent(env, body)
  else if (failure.kind === 'inbound-mail') await env.INBOUND_QUEUE.send(body)
  else await env.OUTBOUND_QUEUE.send(body)
  await db.delete(queueFailures).where(eq(queueFailures.id, id))
  return true
}
