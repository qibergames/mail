import { and, count, eq } from 'drizzle-orm'
import webPush from 'web-push'
import { getDb } from '@/db'
import { messages, pushSubscriptions } from '@/db/schema'
import { createPushPayload } from './push-payload'

type PushError = Error & { statusCode?: number }

export async function sendNewMailPush(
  env: CloudflareEnv,
  userIds: Array<string>,
  message: { id: string; mailboxId: string; from: string; subject?: string | null },
) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return
  const db = getDb(env.DB)
  const unread = (await db.select({ value: count() }).from(messages).where(and(
    eq(messages.mailboxId, message.mailboxId),
    eq(messages.status, 'received'),
    eq(messages.read, false),
  ))).at(0)?.value ?? 1
  const subscriptions = (await Promise.all(userIds.map((userId) => db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))))).flat()

  await Promise.allSettled(subscriptions.map(async (subscription) => {
    const payload = JSON.stringify(createPushPayload(subscription.locale, message, unread))
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, {
        TTL: 86_400,
        urgency: 'high',
        topic: message.id.replace(/[^A-Za-z0-9_-]/g, '').slice(-32),
        vapidDetails: {
          subject: env.VAPID_SUBJECT!,
          publicKey: env.VAPID_PUBLIC_KEY!,
          privateKey: env.VAPID_PRIVATE_KEY!,
        },
      })
    } catch (error) {
      if ([404, 410].includes((error as PushError).statusCode ?? 0)) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, subscription.endpoint))
      } else {
        console.error('Web Push delivery failed', error)
      }
    }
  }))
}
