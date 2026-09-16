import { createFileRoute } from '@tanstack/react-router'
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '@/db'
import { domains, mailboxAliases, mailboxes } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { accessibleMailboxIds } from '@/lib/email/outbound'

export const Route = createFileRoute('/api/mailboxes')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        const ids = await accessibleMailboxIds(session.user.id)
        if (!ids.length) return Response.json([])
        const rows = await getDb()
          .select({
            id: mailboxes.id,
            name: mailboxes.displayName,
            localPart: mailboxes.localPart,
            hostname: domains.hostname,
            type: mailboxes.type,
          })
          .from(mailboxes)
          .innerJoin(domains, eq(mailboxes.domainId, domains.id))
          .where(inArray(mailboxes.id, ids))
        // Aliases are addresses of the same mailbox, so they can be sent from as well as received on.
        const aliases = await getDb()
          .select({ id: mailboxAliases.id, mailboxId: mailboxAliases.mailboxId, localPart: mailboxAliases.localPart, hostname: domains.hostname })
          .from(mailboxAliases)
          .innerJoin(domains, eq(mailboxAliases.domainId, domains.id))
          .where(inArray(mailboxAliases.mailboxId, ids))
        return Response.json(rows.map((row) => ({
          ...row,
          address: `${row.localPart}@${row.hostname}`,
          aliases: aliases.filter((alias) => alias.mailboxId === row.id).map((alias) => ({ id: alias.id, address: `${alias.localPart}@${alias.hostname}` })),
        })))
      },
    },
  },
})
