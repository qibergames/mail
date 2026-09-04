import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '@/db'
import { requireSession } from '@/lib/api-auth'
import { accessibleMailboxIds } from '@/lib/email/outbound'
import { syncMessages } from '@/lib/email/sync'

export const Route = createFileRoute('/api/messages/sync')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        const url = new URL(request.url)
        const accessible = await accessibleMailboxIds(session.user.id)
        const sinceParam = url.searchParams.get('since')
        const since = sinceParam && /^\d+$/.test(sinceParam) ? Number(sinceParam) : null
        const result = await syncMessages(getDb(), session.user.id, accessible, since)
        return Response.json({ ...result, mailboxIds: accessible }, { headers: { 'Cache-Control': 'no-store' } })
      },
    },
  },
})
