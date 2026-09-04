import { createFileRoute } from '@tanstack/react-router'
import { and, desc, inArray } from 'drizzle-orm'
import { getDb } from '@/db'
import { messages } from '@/db/schema'
import { authenticateApiKey } from '@/lib/api-keys'
import { accessibleMailboxIds } from '@/lib/email/outbound'

export const Route = createFileRoute('/api/v1/messages')({ server: { handlers: { GET: async ({ request }) => {
  const key = await authenticateApiKey(request, 'messages:read')
  const accessible = await accessibleMailboxIds(key.userId)
  const url = new URL(request.url)
  const mailboxId = url.searchParams.get('mailboxId')
  const ids = mailboxId && accessible.includes(mailboxId) ? [mailboxId] : accessible
  if (!ids.length) return Response.json({ data: [] })
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50))
  return Response.json({ data: await getDb().select().from(messages).where(and(inArray(messages.mailboxId, ids))).orderBy(desc(messages.createdAt)).limit(limit) })
} } } })
