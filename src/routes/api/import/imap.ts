import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { requireSession } from '@/lib/api-auth'
import { importRawEmails } from '@/lib/email/import'
import { fetchImapMessages, listImapFolders } from '@/lib/imap'

const connection = z.object({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535).default(993), username: z.string().min(1).max(320), password: z.string().min(1).max(1000) })
const importSchema = connection.extend({ mailboxId: z.string(), folder: z.string().min(1).max(1000).default('INBOX'), limit: z.number().int().min(1).max(200).default(50) })

export const Route = createFileRoute('/api/import/imap')({ server: { handlers: {
  PUT: async ({ request }) => { await requireSession(request); const input = connection.safeParse(await request.json().catch(() => null)); if (!input.success) return Response.json({ error: 'Invalid IMAP connection' }, { status: 400 }); try { return Response.json({ folders: await listImapFolders(input.data) }) } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'IMAP failed' }, { status: 400 }) } },
  POST: async ({ request }) => { const session = await requireSession(request); const input = importSchema.safeParse(await request.json().catch(() => null)); if (!input.success) return Response.json({ error: 'Invalid IMAP import' }, { status: 400 }); try { const files = await fetchImapMessages(input.data); const ids = await importRawEmails(env, session.user.id, input.data.mailboxId, files); return Response.json({ imported: ids.length, ids }) } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'IMAP import failed' }, { status: 400 }) } },
} } })
