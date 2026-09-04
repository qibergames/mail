import { createFileRoute } from '@tanstack/react-router'
import { and, asc, inArray } from 'drizzle-orm'
import { getDb } from '@/db'
import { messages } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { accessibleMailboxIds } from '@/lib/email/outbound'

function header(value: string | null) { return (value ?? '').replace(/[\r\n]+/g, ' ') }

export const Route = createFileRoute('/api/export')({ server: { handlers: { GET: async ({ request }) => {
  const session = await requireSession(request)
  const available = await accessibleMailboxIds(session.user.id); const requested = new URL(request.url).searchParams.get('mailboxId'); const ids = requested && available.includes(requested) ? [requested] : available
  const rows = ids.length ? await getDb().select().from(messages).where(and(inArray(messages.mailboxId, ids))).orderBy(asc(messages.createdAt)) : []
  const mbox = rows.map((message) => `From MAILER-DAEMON ${message.createdAt.toUTCString()}\nFrom: ${header(message.fromAddr)}\nTo: ${header(message.toAddr)}\nSubject: ${header(message.subject)}\nDate: ${message.createdAt.toUTCString()}\nMessage-ID: ${header(message.providerMessageId || message.id)}\nContent-Type: text/plain; charset=utf-8\n\n${(message.textBody ?? '').replace(/^From /gm, '>From ')}\n`).join('\n')
  return new Response(mbox, { headers: { 'Content-Type': 'application/mbox; charset=utf-8', 'Content-Disposition': 'attachment; filename="qibermail-export.mbox"', 'Cache-Control': 'private, no-store' } })
} } } })
