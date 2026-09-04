import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq, gt, inArray, isNull, like, lte, or } from 'drizzle-orm'
import { getDb } from '@/db'
import { messages } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { accessibleMailboxIds } from '@/lib/email/outbound'
import { messageSummaryColumns } from '@/lib/email/sync'

export const Route = createFileRoute('/api/messages')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        const url = new URL(request.url)
        const accessible = await accessibleMailboxIds(session.user.id)
        const requested = url.searchParams.get('mailboxId')
        const mailboxIds = requested && accessible.includes(requested) ? [requested] : accessible
        if (!mailboxIds.length) return Response.json([])

        const view = url.searchParams.get('view') ?? 'inbox'
        const folderId = url.searchParams.get('folderId')
        const query = url.searchParams.get('q')?.trim()
        const viewFilters = view === 'sent'
          ? [eq(messages.direction, 'outbound'), inArray(messages.status, ['queued', 'scheduled', 'sent', 'failed'])]
          : view === 'drafts'
            ? [eq(messages.status, 'draft')]
            : view === 'starred'
              ? [eq(messages.starred, true)]
              : view === 'snoozed'
                ? [gt(messages.snoozedUntil, new Date())]
                : view === 'archived' || view === 'spam' || view === 'trash'
                  ? [eq(messages.status, view)]
                  : folderId
                    ? [eq(messages.folderId, folderId)]
                    : [eq(messages.status, 'received'), or(isNull(messages.snoozedUntil), lte(messages.snoozedUntil, new Date()))!]
        const filters = [
          inArray(messages.mailboxId, mailboxIds),
          ...viewFilters,
          ...(query ? [or(like(messages.subject, `%${query}%`), like(messages.fromAddr, `%${query}%`), like(messages.toAddr, `%${query}%`), like(messages.textBody, `%${query}%`))!] : []),
        ]
        return Response.json(await getDb().select(messageSummaryColumns).from(messages).where(and(...filters)).orderBy(desc(messages.createdAt)).limit(100))
      },
    },
  },
})
