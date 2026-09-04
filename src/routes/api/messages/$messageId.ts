import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import PostalMime from 'postal-mime'
import { getDb } from '@/db'
import { messageAttachments, messages } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { accessibleMailboxIds } from '@/lib/email/outbound'
import { extractSecurityDetails } from '@/lib/email/security'
import { notifyRealtime } from '@/lib/email/sync'

export const Route = createFileRoute('/api/messages/$messageId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await requireSession(request)
        const message = (await getDb().select().from(messages).where(eq(messages.id, params.messageId)).limit(1)).at(0)
        if (!message?.mailboxId || !(await accessibleMailboxIds(session.user.id)).includes(message.mailboxId)) {
          return new Response('Not found', { status: 404 })
        }
        const attachments = await getDb().select({
          id: messageAttachments.id,
          filename: messageAttachments.filename,
          contentType: messageAttachments.contentType,
          size: messageAttachments.size,
          disposition: messageAttachments.disposition,
          contentId: messageAttachments.contentId,
        }).from(messageAttachments).where(eq(messageAttachments.messageId, message.id))
        const raw = message.rawR2Key ? await env.BUCKET.get(message.rawR2Key) : null
        const security = raw
          ? await raw.arrayBuffer()
              .then(async (buffer) => extractSecurityDetails((await PostalMime.parse(buffer)).headers))
              .catch(() => null)
          : null
        return Response.json({ message, attachments, security })
      },
      PATCH: async ({ request, params }) => {
        const session = await requireSession(request)
        const message = (await getDb().select().from(messages).where(eq(messages.id, params.messageId)).limit(1)).at(0)
        if (!message?.mailboxId || !(await accessibleMailboxIds(session.user.id)).includes(message.mailboxId)) {
          return new Response('Not found', { status: 404 })
        }
        const body = await request.json<{ read?: boolean; starred?: boolean; status?: string; snoozedUntil?: string | null }>()
        const statuses = ['received', 'archived', 'spam', 'trash']
        await getDb().update(messages).set({
          ...(typeof body.read === 'boolean' ? { read: body.read } : {}),
          ...(typeof body.starred === 'boolean' ? { starred: body.starred } : {}),
          ...(body.status && statuses.includes(body.status) ? { status: body.status } : {}),
          ...(body.snoozedUntil !== undefined ? { snoozedUntil: body.snoozedUntil ? new Date(body.snoozedUntil) : null } : {}),
        }).where(eq(messages.id, message.id))
        await notifyRealtime(env, [session.user.id], { type: 'message:update', messageId: message.id, mailboxId: message.mailboxId })
        return new Response(null, { status: 204 })
      },
    },
  },
})
