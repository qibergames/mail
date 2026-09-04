import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { DatabaseBackupWorkflow } from '@/lib/backups/workflow'
import { startScheduledBackup } from '@/lib/backups/schedule'
import { auth } from '@/lib/auth'
import { acceptInboundEmail, processInboundEmail } from '@/lib/email/inbound'
import type { InboundQueueMessage } from '@/lib/email/inbound'
import { processOutboundEmail, queueScheduledEmails } from '@/lib/email/outbound'
import type { OutboundQueueMessage } from '@/lib/email/outbound'
import { RealtimeHub } from '@/lib/realtime/hub'
import { processWebhook } from '@/lib/webhooks'
import type { WebhookQueueMessage } from '@/lib/webhooks'

export { DatabaseBackupWorkflow, RealtimeHub }

const app = createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})

type QueueMessage = {
  type?: string
  from?: string
  to?: string
  url?: string
}

function isInbound(value: unknown): value is InboundQueueMessage {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'inbound-mail'
}

function isOutbound(value: unknown): value is OutboundQueueMessage {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'outbound-mail'
}

function isWebhook(value: unknown): value is WebhookQueueMessage {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'webhook'
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/realtime') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 })
      }
      const session = await auth.api.getSession({ headers: request.headers })
      if (!session || session.user.banned) return new Response('Unauthorized', { status: 401 })
      return env.REALTIME.getByName(session.user.id).fetch(new Request('https://qibermail-realtime/connect', request))
    }
    const response = await app.fetch(request)
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss: https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (new URL(request.url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
  email(message, env) {
    return acceptInboundEmail(env, message)
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      const body = message.body as QueueMessage
      try {
        if (isInbound(message.body)) {
          await processInboundEmail(env, message.body)
          message.ack()
        } else if (isOutbound(message.body)) {
          await processOutboundEmail(env, message.body)
          message.ack()
        } else if (isWebhook(message.body)) {
          await processWebhook(env, message.body)
          message.ack()
        } else if (body.type === 'password-reset' && body.from && body.to && body.url) {
          await env.EMAIL.send({
            from: body.from,
            to: body.to,
            subject: 'QiberMail password reset',
            text: `Reset your QiberMail password: ${body.url}`,
          })
          message.ack()
        } else {
          console.error('Unknown QiberMail queue message', message.body)
          message.ack()
        }
      } catch (error) {
        console.error('Queue processing failed', error)
        message.retry({ delaySeconds: 60 })
      }
    }
  },
  async scheduled(controller, env) {
    if (controller.cron === '* * * * *') await queueScheduledEmails(env)
    if (controller.cron === '0 2 * * *') await startScheduledBackup(env)
  },
} satisfies ExportedHandler<CloudflareEnv>
