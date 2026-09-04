import { createFileRoute } from '@tanstack/react-router'
import { and, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/db'
import { messages } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { accessibleMailboxIds } from '@/lib/email/outbound'

const schema = z.object({ ids: z.array(z.string()).min(1).max(100), read: z.boolean().optional(), starred: z.boolean().optional(), status: z.enum(['received', 'archived', 'spam', 'trash']).optional() })

export const Route = createFileRoute('/api/messages/bulk')({ server: { handlers: { PATCH: async ({ request }) => {
  const session = await requireSession(request)
  const input = schema.safeParse(await request.json().catch(() => null))
  if (!input.success) return Response.json({ error: 'Invalid bulk action' }, { status: 400 })
  const mailboxIds = await accessibleMailboxIds(session.user.id)
  if (!mailboxIds.length) return new Response(null, { status: 204 })
  await getDb().update(messages).set({
    ...(input.data.read === undefined ? {} : { read: input.data.read }),
    ...(input.data.starred === undefined ? {} : { starred: input.data.starred }),
    ...(input.data.status === undefined ? {} : { status: input.data.status }),
  }).where(and(inArray(messages.id, input.data.ids), inArray(messages.mailboxId, mailboxIds)))
  return new Response(null, { status: 204 })
} } } })
