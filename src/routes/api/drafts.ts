import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/db'
import { domains, mailboxes, messages } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { accessibleMailboxIds } from '@/lib/email/outbound'
import { newId } from '@/lib/ids'
import { removeMessages } from '@/lib/email/sync'

const schema = z.object({ id: z.string().optional(), mailboxId: z.string(), to: z.string().max(320).default(''), subject: z.string().max(998).default(''), text: z.string().max(2_000_000).default('') })

export const Route = createFileRoute('/api/drafts')({ server: { handlers: {
  POST: async ({ request }) => {
    const session = await requireSession(request)
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success || !(await accessibleMailboxIds(session.user.id)).includes(parsed.data.mailboxId)) return Response.json({ error: 'Invalid draft' }, { status: 400 })
    const db = getDb()
    const mailbox = (await db.select({ localPart: mailboxes.localPart, hostname: domains.hostname }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(eq(mailboxes.id, parsed.data.mailboxId)).limit(1)).at(0)!
    const id = parsed.data.id ?? newId('msg')
    const values = { mailboxId: parsed.data.mailboxId, toAddr: parsed.data.to, subject: parsed.data.subject, textBody: parsed.data.text, snippet: parsed.data.text.replace(/\s+/g, ' ').slice(0, 200) }
    if (parsed.data.id) {
      const updated = await db.update(messages).set(values).where(and(eq(messages.id, id), eq(messages.userId, session.user.id), eq(messages.status, 'draft'))).returning({ id: messages.id })
      if (!updated.length) return new Response('Not found', { status: 404 })
    } else {
      await db.insert(messages).values({ id, userId: session.user.id, ...values, direction: 'outbound', fromAddr: `${mailbox.localPart}@${mailbox.hostname}`, status: 'draft' })
    }
    return Response.json({ id })
  },
  DELETE: async ({ request }) => {
    const session = await requireSession(request)
    const id = new URL(request.url).searchParams.get('id')
    if (id) await removeMessages(getDb(), and(eq(messages.id, id), eq(messages.userId, session.user.id), eq(messages.status, 'draft'))!)
    return new Response(null, { status: 204 })
  },
} } })
