import { and, eq, inArray, sql } from 'drizzle-orm'
import PostalMime from 'postal-mime'
import { getDb } from '@/db'
import { autoReplyDeliveries, contacts, mailboxAccess, messages, routingRules, users } from '@/db/schema'
import { newId } from '@/lib/ids'
import { formatAddress, parseAddress } from './address'
import { storeAttachments } from './attachments'
import { resolveDestination, resolveInbound } from './routing'
import { sendNewMailPush } from '@/lib/push'
import { enqueueWebhookEvent } from '@/lib/webhooks'

export type InboundQueueMessage = {
  type: 'inbound-mail'
  from: string
  to: string
  rawR2Key: string
  headers: Record<string, string>
}

function textFromHtml(html?: string | null) {
  return (html ?? '').replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function attachmentBuffer(content: string | Uint8Array | ArrayBuffer) {
  if (content instanceof ArrayBuffer) return content
  if (typeof content === 'string') return new TextEncoder().encode(content).buffer
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer
}

export async function storeRawEmail(env: CloudflareEnv, message: ForwardableEmailMessage) {
  const key = `inbound/${Date.now()}-${newId()}.eml`
  await env.BUCKET.put(key, await new Response(message.raw).arrayBuffer(), {
    httpMetadata: { contentType: 'message/rfc822' },
    customMetadata: { from: message.from, to: message.to },
  })
  return key
}

export async function acceptInboundEmail(env: CloudflareEnv, message: ForwardableEmailMessage) {
  const db = getDb(env.DB)
  const decision = await resolveInbound(db, message.to, message.from)
  if (!decision) {
    message.setReject('Unknown QiberMail recipient')
    return
  }
  if (decision.ruleId) {
    await db.update(routingRules).set({
      lastMatchedAt: new Date(),
      matchCount: sql`${routingRules.matchCount} + 1`,
    }).where(eq(routingRules.id, decision.ruleId))
  }
  if (decision.action === 'reject') {
    message.setReject(decision.rejectReason ?? 'Message rejected by routing rule')
    return
  }
  if (decision.action === 'forward' && decision.forwardTo) {
    try {
      await message.forward(decision.forwardTo, new Headers({ 'X-QiberMail-Forwarded': '1' }))
      if (!decision.keepCopy) return
    } catch (error) {
      console.error('Forwarding failed; storing a copy', error)
    }
  }

  if (decision.mailbox && message.headers.get('X-QiberMail-Forwarded') !== '1') {
    const owner = (await db.select({ forwardingEmail: users.forwardingEmail }).from(users).where(eq(users.id, decision.mailbox.userId)).limit(1)).at(0)
    if (owner?.forwardingEmail) {
      await message.forward(owner.forwardingEmail, new Headers({ 'X-QiberMail-Forwarded': '1' })).catch((error) => {
        console.error('Account forwarding failed; storing a copy', error)
      })
    }
  }

  const rawR2Key = await storeRawEmail(env, message)
  await env.INBOUND_QUEUE.send({
    type: 'inbound-mail',
    from: message.from,
    to: message.to,
    rawR2Key,
    headers: Object.fromEntries([...message.headers].map(([key, value]) => [key.toLowerCase(), value])),
  } satisfies InboundQueueMessage)
}

export async function processInboundEmail(env: CloudflareEnv, payload: InboundQueueMessage) {
  const db = getDb(env.DB)
  const existing = (await db.select({ id: messages.id }).from(messages).where(eq(messages.rawR2Key, payload.rawR2Key)).limit(1)).at(0)
  if (existing) return existing.id

  const decision = await resolveInbound(db, payload.to, payload.from)
  if (!decision?.mailbox || decision.action === 'reject' || (decision.action === 'forward' && !decision.keepCopy)) return null
  const raw = await env.BUCKET.get(payload.rawR2Key)
  if (!raw) throw new Error(`Missing raw email ${payload.rawR2Key}`)
  const parsed = await PostalMime.parse(await raw.arrayBuffer())
  const from = parsed.from && 'address' in parsed.from
    ? formatAddress(parsed.from.address ?? payload.from, parsed.from.name)
    : payload.from
  const text = parsed.text ?? null
  const html = parsed.html ?? null
  const snippet = (text?.trim() || textFromHtml(html)).replace(/\s+/g, ' ').slice(0, 200)
  const destination = await resolveDestination(db, decision.mailbox.id, {
    to: payload.to,
    from,
    subject: parsed.subject,
    content: `${text ?? ''} ${textFromHtml(html)}`,
  })
  const senderAddress = (parsed.from && 'address' in parsed.from ? parsed.from.address ?? payload.from : payload.from).toLowerCase()
  const blocked = (await db.select({ blocked: contacts.blocked }).from(contacts).where(and(eq(contacts.userId, decision.mailbox.userId), eq(contacts.email, senderAddress))).limit(1)).at(0)?.blocked
  const finalStatus = blocked ? 'spam' : destination.status
  const messageId = newId('msg')

  await db.insert(messages).values({
    id: messageId,
    userId: decision.mailbox.userId,
    mailboxId: decision.mailbox.id,
    folderId: destination.folderId,
    direction: 'inbound',
    providerMessageId: parsed.messageId,
    fromAddr: from,
    toAddr: payload.to,
    subject: parsed.subject,
    snippet,
    textBody: text,
    htmlBody: html,
    rawR2Key: payload.rawR2Key,
    status: finalStatus,
    threadId: parsed.messageId,
  })

  const attachments = parsed.attachments.map((attachment, index) => ({
    filename: attachment.filename ?? `attachment-${index + 1}`,
    type: attachment.mimeType || 'application/octet-stream',
    content: attachmentBuffer(attachment.content),
    disposition: attachment.disposition === 'inline' ? 'inline' as const : 'attachment' as const,
    contentId: attachment.contentId,
  }))
  try {
    await storeAttachments(env, messageId, attachments)
  } catch (error) {
    await db.delete(messages).where(eq(messages.id, messageId))
    throw error
  }

  await db.insert(contacts).values({
    id: newId('con'),
    userId: decision.mailbox.userId,
    email: senderAddress,
    displayName: parsed.from && 'name' in parsed.from ? parsed.from.name : null,
    source: 'inbound',
    lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: [contacts.userId, contacts.email],
    set: { lastSeenAt: new Date() },
  })

  const access = await db.select({ userId: mailboxAccess.userId }).from(mailboxAccess).where(eq(mailboxAccess.mailboxId, decision.mailbox.id))
  const userIds = [...new Set([decision.mailbox.userId, ...access.map((item) => item.userId)])]
  await Promise.all(userIds.map((userId) => env.REALTIME.getByName(userId).fetch('https://qibermail-realtime/notify', {
    method: 'POST',
    body: JSON.stringify({ type: 'message:new', messageId, mailboxId: decision.mailbox!.id }),
  })))
  await sendNewMailPush(env, userIds, {
    id: messageId,
    mailboxId: decision.mailbox.id,
    from,
    subject: parsed.subject,
  }).catch((error) => console.error('Web Push dispatch failed', error))
  await enqueueWebhookEvent(env, decision.mailbox.userId, 'message.received', { messageId, mailboxId: decision.mailbox.id, from, to: payload.to, subject: parsed.subject }).catch((error) => console.error('Webhook enqueue failed', error))

  if (decision.mailbox.autoReplyEnabled && finalStatus === 'received') {
    const automated = payload.headers['auto-submitted'] || payload.headers['precedence']
    const recipient = parseAddress(payload.from)?.address
    const delivery = recipient
      ? (await db.select().from(autoReplyDeliveries).where(and(
          eq(autoReplyDeliveries.mailboxId, decision.mailbox.id),
          eq(autoReplyDeliveries.recipient, recipient),
        )).limit(1)).at(0)
      : null
    const due = !delivery || Date.now() - delivery.sentAt.getTime() >= 86_400_000
    if (!automated && recipient && due) {
      await env.EMAIL.send({
        from: `${decision.mailbox.localPart}@${decision.mailbox.hostname}`,
        to: recipient,
        subject: decision.mailbox.autoReplySubject,
        text: decision.mailbox.autoReplyBody,
        headers: { 'Auto-Submitted': 'auto-replied' },
      }).then(() => db.insert(autoReplyDeliveries).values({
        id: delivery?.id ?? newId('ard'),
        mailboxId: decision.mailbox!.id,
        recipient,
        sentAt: new Date(),
      }).onConflictDoUpdate({
        target: [autoReplyDeliveries.mailboxId, autoReplyDeliveries.recipient],
        set: { sentAt: new Date() },
      })).catch((error) => console.error('Auto-reply failed', error))
    }
  }

  return messageId
}

export async function listMessagesForMailboxes(mailboxIds: Array<string>, status = 'received') {
  if (!mailboxIds.length) return []
  return getDb().select().from(messages).where(and(
    inArray(messages.mailboxId, mailboxIds),
    eq(messages.status, status),
  )).orderBy(sql`${messages.createdAt} DESC`).limit(100)
}
