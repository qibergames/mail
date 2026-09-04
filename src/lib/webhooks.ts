import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import { webhookDeliveries, webhooks } from '@/db/schema'
import { newId } from '@/lib/ids'

export type WebhookQueueMessage = { type: 'webhook'; deliveryId: string }

export async function enqueueWebhookEvent(env: CloudflareEnv, userId: string, eventType: string, payload: unknown) {
  const rows = await getDb(env.DB).select().from(webhooks).where(eq(webhooks.userId, userId))
  for (const webhook of rows.filter((item) => item.enabled && (JSON.parse(item.events) as Array<string>).includes(eventType))) {
    const deliveryId = newId('whd')
    await getDb(env.DB).insert(webhookDeliveries).values({ id: deliveryId, webhookId: webhook.id, eventType, payload: JSON.stringify(payload) })
    await env.OUTBOUND_QUEUE.send({ type: 'webhook', deliveryId } satisfies WebhookQueueMessage)
  }
}

export async function processWebhook(env: CloudflareEnv, payload: WebhookQueueMessage) {
  const db = getDb(env.DB)
  const row = (await db.select({ delivery: webhookDeliveries, webhook: webhooks }).from(webhookDeliveries).innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id)).where(eq(webhookDeliveries.id, payload.deliveryId)).limit(1)).at(0)
  if (!row || row.delivery.status === 'delivered' || row.delivery.status === 'exhausted' || !row.webhook.enabled) return
  const started = Date.now()
  const signature = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', new TextEncoder().encode(row.webhook.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode(row.delivery.payload))
  const hex = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const attempts = row.delivery.attempts + 1
  try {
    const response = await fetch(row.webhook.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-QiberMail-Event': row.delivery.eventType, 'X-QiberMail-Signature': `sha256=${hex}` }, body: row.delivery.payload, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw Object.assign(new Error(`Webhook returned ${response.status}`), { responseStatus: response.status })
    await db.update(webhookDeliveries).set({ status: 'delivered', attempts, responseStatus: response.status, durationMs: Date.now() - started, lastAttemptAt: new Date(), error: null }).where(eq(webhookDeliveries.id, row.delivery.id))
  } catch (error) {
    const exhausted = attempts >= row.webhook.maxAttempts
    await db.update(webhookDeliveries).set({ status: exhausted ? 'exhausted' : 'retrying', attempts, responseStatus: typeof error === 'object' && error && 'responseStatus' in error ? Number(error.responseStatus) : null, durationMs: Date.now() - started, lastAttemptAt: new Date(), nextRetryAt: exhausted ? null : new Date(Date.now() + Math.min(3600, 2 ** attempts * 30) * 1000), error: error instanceof Error ? error.message : 'Webhook failed' }).where(eq(webhookDeliveries.id, row.delivery.id))
    if (!exhausted) throw error
  }
}
