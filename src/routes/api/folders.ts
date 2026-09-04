import { createFileRoute } from '@tanstack/react-router'
import { inArray } from 'drizzle-orm'
import { getDb } from '@/db'
import { folders } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { accessibleMailboxIds } from '@/lib/email/outbound'

export const Route = createFileRoute('/api/folders')({ server: { handlers: { GET: async ({ request }) => {
  const session = await requireSession(request)
  const ids = await accessibleMailboxIds(session.user.id)
  return Response.json(ids.length ? await getDb().select().from(folders).where(inArray(folders.mailboxId, ids)) : [])
} } } })
