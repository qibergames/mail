import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { requireSession } from '@/lib/api-auth'
import { importRawEmails } from '@/lib/email/import'

const schema = z.object({ mailboxId: z.string(), files: z.array(z.object({ name: z.string().max(255), content: z.string().max(14_000_000) })).min(1).max(20) })
function decode(value: string) { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer }

export const Route = createFileRoute('/api/import')({ server: { handlers: { POST: async ({ request }) => {
  const session = await requireSession(request)
  if (Number(request.headers.get('content-length') ?? 0) > 28 * 1024 * 1024) return new Response('Import too large', { status: 413 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid import' }, { status: 400 })
  const ids = await importRawEmails(env, session.user.id, parsed.data.mailboxId, parsed.data.files.map((file) => ({ name: file.name, content: decode(file.content) })))
  return Response.json({ imported: ids.length, ids })
} } } })
