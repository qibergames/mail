import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { requireSession } from '@/lib/api-auth'
import { queueOutboundEmail } from '@/lib/email/outbound'

const sendSchema = z.object({
  mailboxId: z.string().min(1),
  to: z.email(),
  subject: z.string().max(998).default(''),
  text: z.string().max(2_000_000).default(''),
  html: z.string().max(2_000_000).optional(),
  draftId: z.string().optional(),
  scheduledAt: z.iso.datetime().optional(),
  attachments: z.array(z.object({
    filename: z.string().min(1).max(255),
    type: z.string().min(1).max(255),
    content: z.string().max(14_000_000),
    disposition: z.enum(['attachment', 'inline']).optional(),
    contentId: z.string().max(255).optional(),
  })).max(10).optional(),
})

function decodeBase64(content: string) {
  const binary = atob(content.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

export const Route = createFileRoute('/api/send')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request)
        if (Number(request.headers.get('content-length') ?? 0) > 28 * 1024 * 1024) {
          return Response.json({ error: 'body_too_large' }, { status: 413 })
        }
        const parsed = sendSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'invalid_message', details: parsed.error.flatten() }, { status: 400 })
        try {
          return Response.json(await queueOutboundEmail(env, session.user.id, {
            ...parsed.data,
            scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
            attachments: parsed.data.attachments?.map((attachment) => ({
              ...attachment,
              content: decodeBase64(attachment.content),
            })),
          }), { status: 202 })
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : 'Send failed' }, { status: 400 })
        }
      },
    },
  },
})
