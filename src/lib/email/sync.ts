import { and, desc, eq, gt, inArray } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AppDatabase } from '@/db'
import { messageTombstones, messages } from '@/db/schema'

/** Summary columns synced to clients; bodies are fetched per message and cached separately. */
export const messageSummaryColumns = {
  id: messages.id,
  mailboxId: messages.mailboxId,
  direction: messages.direction,
  folderId: messages.folderId,
  fromAddr: messages.fromAddr,
  toAddr: messages.toAddr,
  subject: messages.subject,
  snippet: messages.snippet,
  status: messages.status,
  read: messages.read,
  starred: messages.starred,
  snoozedUntil: messages.snoozedUntil,
  threadId: messages.threadId,
  createdAt: messages.createdAt,
  updatedAt: messages.updatedAt,
}

/** Hard-deletes messages matching `where` and leaves tombstones so delta sync can drop them on clients. */
export async function removeMessages(db: AppDatabase, where: SQL) {
  const rows = await db.select({ id: messages.id, userId: messages.userId, mailboxId: messages.mailboxId }).from(messages).where(where)
  if (!rows.length) return []
  await db.insert(messageTombstones).values(rows.map((row) => ({ id: row.id, userId: row.userId, mailboxId: row.mailboxId }))).onConflictDoNothing()
  await db.delete(messages).where(inArray(messages.id, rows.map((row) => row.id)))
  return rows.map((row) => row.id)
}

export async function notifyRealtime(env: CloudflareEnv, userIds: string[], payload: { type: 'message:new' | 'message:update' | 'counts:update'; messageId?: string; mailboxId?: string }) {
  await Promise.all([...new Set(userIds)].map((userId) => env.REALTIME.getByName(userId).fetch('https://qibermail-realtime/notify', { method: 'POST', body: JSON.stringify(payload) }).catch(console.warn)))
}

export const INITIAL_SYNC_LIMIT = 400
export const DELTA_SYNC_LIMIT = 1000

/**
 * Delta sync: everything touched after `since` (seconds) for the given mailboxes, plus tombstones.
 * With no cursor, returns the newest INITIAL_SYNC_LIMIT messages per mailbox.
 */
export async function syncMessages(db: AppDatabase, userId: string, mailboxIds: string[], since: number | null) {
  const now = Math.floor(Date.now() / 1000)
  if (!mailboxIds.length) return { now, messages: [], deleted: [], full: since === null, truncated: false }
  if (since === null) {
    const rows = (await Promise.all(mailboxIds.map((mailboxId) => db.select(messageSummaryColumns).from(messages).where(eq(messages.mailboxId, mailboxId)).orderBy(desc(messages.createdAt)).limit(INITIAL_SYNC_LIMIT)))).flat()
    return { now, messages: rows, deleted: [], full: true, truncated: rows.length >= INITIAL_SYNC_LIMIT }
  }
  // Overlap by one second: timestamps are stored with second precision.
  const cursor = new Date((since - 1) * 1000)
  const rows = await db.select(messageSummaryColumns).from(messages).where(and(inArray(messages.mailboxId, mailboxIds), gt(messages.updatedAt, cursor))).orderBy(desc(messages.updatedAt)).limit(DELTA_SYNC_LIMIT)
  const tombstones = await db.select({ id: messageTombstones.id }).from(messageTombstones).where(and(eq(messageTombstones.userId, userId), gt(messageTombstones.deletedAt, cursor))).limit(DELTA_SYNC_LIMIT)
  return { now, messages: rows, deleted: tombstones.map((row) => row.id), full: false, truncated: rows.length >= DELTA_SYNC_LIMIT }
}
