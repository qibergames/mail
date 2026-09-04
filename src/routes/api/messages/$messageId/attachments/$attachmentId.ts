import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { getDb } from '@/db'
import { messageAttachments, messages } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { accessibleMailboxIds } from '@/lib/email/outbound'

export const Route = createFileRoute('/api/messages/$messageId/attachments/$attachmentId')({ server: { handlers: { GET: async ({ request, params }) => {
  const session = await requireSession(request)
  const row = (await getDb().select({ attachment: messageAttachments, mailboxId: messages.mailboxId }).from(messageAttachments).innerJoin(messages, eq(messageAttachments.messageId, messages.id)).where(and(eq(messageAttachments.id, params.attachmentId), eq(messages.id, params.messageId))).limit(1)).at(0)
  if (!row?.mailboxId || !(await accessibleMailboxIds(session.user.id)).includes(row.mailboxId)) return new Response('Not found', { status: 404 })
  const object = await env.BUCKET.get(row.attachment.r2Key)
  if (!object) return new Response('Not found', { status: 404 })
  const preview = new URL(request.url).searchParams.get('preview') === '1' && row.attachment.contentType.startsWith('image/')
  return new Response(object.body, { headers: { 'Content-Type': row.attachment.contentType, 'Content-Length': String(row.attachment.size), 'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.attachment.filename)}`, 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff' } })
} } } })
