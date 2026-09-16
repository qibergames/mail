import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { getDb } from '@/db'
import { calendarEvents, messageAttachments, messages } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { proposeEvent } from '@/lib/email/calendar'
import { readableText } from '@/lib/email/html'
import { accessibleMailboxIds } from '@/lib/email/outbound'
import { newId } from '@/lib/ids'

/** Turns the appointment a message proposes into a calendar entry the user owns. */
export const Route = createFileRoute('/api/messages/$messageId/calendar')({ server: { handlers: { POST: async ({ request, params }) => {
  const session = await requireSession(request)
  const db = getDb()
  const message = (await db.select().from(messages).where(eq(messages.id, params.messageId)).limit(1)).at(0)
  if (!message?.mailboxId || !(await accessibleMailboxIds(session.user.id)).includes(message.mailboxId)) return new Response('Not found', { status: 404 })

  const invitation = (await db.select().from(messageAttachments).where(and(eq(messageAttachments.messageId, message.id), eq(messageAttachments.contentType, 'text/calendar'))).limit(1)).at(0)
  const object = invitation ? await env.BUCKET.get(invitation.r2Key) : null
  const proposal = await proposeEvent(env, db, {
    subject: message.subject,
    text: readableText(message.textBody, message.htmlBody),
    ics: object ? await object.text() : null,
  })
  if (!proposal) return Response.json({ error: 'No appointment found in this message' }, { status: 422 })

  const event = {
    id: newId('evt'),
    userId: session.user.id,
    mailboxId: message.mailboxId,
    title: proposal.title.slice(0, 200),
    description: `${message.fromAddr}\n${message.subject ?? ''}`.trim(),
    location: proposal.location.slice(0, 200),
    attendees: JSON.stringify([message.fromAddr]),
    startsAt: proposal.startsAt,
    endsAt: proposal.endsAt,
  }
  await db.insert(calendarEvents).values(event)
  return Response.json({ ...event, source: proposal.source }, { status: 201 })
} } } })
