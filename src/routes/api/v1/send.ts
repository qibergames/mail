import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { authenticateApiKey } from '@/lib/api-keys'
import { queueOutboundEmail } from '@/lib/email/outbound'

const schema = z.object({ mailboxId: z.string(), to: z.email(), subject: z.string().max(998).default(''), text: z.string().max(2_000_000), html: z.string().max(2_000_000).optional() })

export const Route = createFileRoute('/api/v1/send')({ server: { handlers: { POST: async ({ request }) => {
  const key = await authenticateApiKey(request, 'messages:send')
  const input = schema.safeParse(await request.json().catch(() => null))
  if (!input.success) return Response.json({ error: 'invalid_message', details: input.error.flatten() }, { status: 400 })
  try { return Response.json(await queueOutboundEmail(env, key.userId, input.data), { status: 202 }) } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Send failed' }, { status: 400 }) }
} } } })
