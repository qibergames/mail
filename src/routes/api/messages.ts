import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq, gt, inArray, isNull, like, lte, or } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { getDb } from '@/db'
import { messages } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { accessibleMailboxIds } from '@/lib/email/outbound'
import { isPhrase, rerankMessages, searchTerms } from '@/lib/email/search'
import { messageSummaryColumns } from '@/lib/email/sync'

/** Fallback when no judgment was made: keep only rows the whole phrase appears in. */
function matchesPhrase(row: { subject: string | null; fromAddr: string; toAddr: string; snippet: string | null }, query: string) {
  const phrase = query.toLowerCase()
  return [row.subject, row.fromAddr, row.toAddr, row.snippet].some((value) => value?.toLowerCase().includes(phrase))
}

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
        const matches = (term: string) => or(like(messages.subject, `%${term}%`), like(messages.fromAddr, `%${term}%`), like(messages.toAddr, `%${term}%`), like(messages.textBody, `%${term}%`))!
        // A phrase is a question rather than a substring: widen the candidates to any of its words and let the
        // judgment order them. Without a judgment model the phrase itself still has to appear.
        const phrase = Boolean(query) && isPhrase(query!)
        const terms = phrase ? searchTerms(query!) : []
        const filters = [
          inArray(messages.mailboxId, mailboxIds),
          ...viewFilters,
          ...(query ? [terms.length ? or(...terms.map(matches))! : matches(query)] : []),
        ]
        const rows = await getDb().select(messageSummaryColumns).from(messages).where(and(...filters)).orderBy(desc(messages.createdAt)).limit(100)
        if (!phrase || rows.length < 2) return Response.json(rows)
        const ranked = await rerankMessages(env, getDb(), query!, rows)
        return Response.json(ranked ?? (terms.length ? rows.filter((row) => matchesPhrase(row, query!)) : rows))
      },
    },
  },
})
