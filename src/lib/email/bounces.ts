import { and, desc, eq, gt, inArray, like } from 'drizzle-orm'
import type { AppDatabase } from '@/db'
import { getDb } from '@/db'
import { contacts, messages } from '@/db/schema'
import { newId } from '@/lib/ids'
import { parseAddress } from './address'
import type { EmailSendingEvent } from './delivery-report'
import { notifyRealtime } from './sync'

async function findOutboundMessage(db: AppDatabase, lookup: { providerMessageId?: string | null; sender?: string; recipient: string; subject?: string }) {
  const id = lookup.providerMessageId?.replace(/^<|>$/g, '')
  if (id) {
    const found = (await db.select().from(messages).where(and(eq(messages.direction, 'outbound'), inArray(messages.providerMessageId, [id, `<${id}>`]))).limit(1)).at(0)
    if (found) return found
  }
  // Event IDs are not guaranteed to be the Message-ID header, so fall back to the most recent matching send.
  if (!lookup.sender || lookup.subject === undefined) return undefined
  return (await db.select().from(messages).where(and(
    eq(messages.direction, 'outbound'),
    like(messages.fromAddr, `%${lookup.sender}%`),
    like(messages.toAddr, `%${lookup.recipient}%`),
    eq(messages.subject, lookup.subject),
    gt(messages.createdAt, new Date(Date.now() - 7 * 86_400_000)),
  )).orderBy(desc(messages.createdAt)).limit(1)).at(0)
}

async function markContact(db: AppDatabase, userId: string, email: string, reason: string | null) {
  const address = email.toLowerCase()
  if (reason === null) {
    await db.update(contacts).set({ undeliverableAt: null, undeliverableReason: null }).where(and(eq(contacts.userId, userId), eq(contacts.email, address)))
    return
  }
  await db.insert(contacts).values({ id: newId('con'), userId, email: address, source: 'outbound', undeliverableAt: new Date(), undeliverableReason: reason })
    .onConflictDoUpdate({ target: [contacts.userId, contacts.email], set: { undeliverableAt: new Date(), undeliverableReason: reason } })
}

/**
 * Marks the sent message as undelivered and, for permanent failures, flags the address so the composer can warn
 * before the next attempt. Returns whether the failure belonged to one of our messages.
 */
export async function recordDeliveryFailure(env: CloudflareEnv, failure: { providerMessageId?: string | null; sender?: string; recipient: string; subject?: string; reason: string; permanent: boolean }) {
  const db = getDb(env.DB)
  const message = await findOutboundMessage(db, failure)
  if (!message) return false
  await db.update(messages).set({ status: 'failed', deliveryError: failure.reason }).where(eq(messages.id, message.id))
  if (failure.permanent) await markContact(db, message.userId, failure.recipient, failure.reason)
  await notifyRealtime(env, [message.userId], { type: 'message:update', messageId: message.id, mailboxId: message.mailboxId ?? undefined })
  return true
}

export async function handleEmailSendingEvent(env: CloudflareEnv, event: EmailSendingEvent) {
  const { payload } = event
  const recipient = payload.recipient && parseAddress(payload.recipient)?.address
  if (!recipient) return
  const lookup = { providerMessageId: payload.messageId, sender: payload.sender, recipient, subject: payload.subject }
  const smtp = payload.bounce?.reason ?? payload.delivery?.smtpResponse
  if (event.type === 'cf.email.sending.message.bounced') {
    await recordDeliveryFailure(env, { ...lookup, reason: smtp ?? 'Delivery failed', permanent: payload.bounce?.type !== 'soft' })
  } else if (event.type === 'cf.email.sending.message.rejected') {
    // Cloudflare suppresses addresses that hard bounced or complained before, so these sends never leave.
    const rejection = payload.rejection
    await recordDeliveryFailure(env, { ...lookup, reason: rejection?.detail ?? rejection?.reason ?? 'Rejected before delivery', permanent: rejection?.reason === 'suppressed' })
  } else if (event.type === 'cf.email.sending.message.failed') {
    await recordDeliveryFailure(env, { ...lookup, reason: payload.failure?.reason ?? 'Delivery failed', permanent: false })
  } else if (event.type === 'cf.email.sending.message.complained') {
    const db = getDb(env.DB)
    const message = await findOutboundMessage(db, lookup)
    if (message) await markContact(db, message.userId, recipient, 'The recipient reported your message as spam')
  } else if (event.type === 'cf.email.sending.message.delivered') {
    const db = getDb(env.DB)
    const message = await findOutboundMessage(db, lookup)
    if (message) await markContact(db, message.userId, recipient, null)
  }
}
