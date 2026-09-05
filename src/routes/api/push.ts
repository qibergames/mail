import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { getDb } from '@/db'
import { pushSubscriptions } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { newId } from '@/lib/ids'
import { isPublicHttpsUrl } from '@/lib/public-url'
import { normalizeVapidKey } from '@/lib/vapid'

const endpoint = z.string().url().max(2048).refine(isPublicHttpsUrl)
const subscriptionSchema = z.object({
  subscription: z.object({
    endpoint,
    keys: z.object({ p256dh: z.string().min(20).max(512), auth: z.string().min(8).max(256) }),
  }),
  locale: z.enum(['hu', 'en']).default('hu'),
})

export const Route = createFileRoute('/api/push')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await requireSession(request)
        const publicKey = normalizeVapidKey(env.VAPID_PUBLIC_KEY, 65)
        const privateKey = normalizeVapidKey(env.VAPID_PRIVATE_KEY, 32)
        if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return Response.json({ error: 'Web Push is not configured: set VAPID_SUBJECT, VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY' }, { status: 503 })
        if (!publicKey.key || !privateKey.key) return Response.json({ error: `VAPID keys are invalid (public: ${publicKey.error ?? 'ok'}, private: ${privateKey.error ?? 'ok'}). Regenerate them with "bunx web-push generate-vapid-keys" and set the secrets again.` }, { status: 503 })
        return Response.json({ publicKey: publicKey.key })
      },
      POST: async ({ request }) => {
        const session = await requireSession(request)
        const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'Invalid push subscription' }, { status: 400 })
        const { subscription, locale } = parsed.data
        await getDb().insert(pushSubscriptions).values({
          id: newId('push'),
          userId: session.user.id,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          locale,
        }).onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: session.user.id,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            locale,
            updatedAt: new Date(),
          },
        })
        return new Response(null, { status: 204 })
      },
      DELETE: async ({ request }) => {
        const session = await requireSession(request)
        const parsed = z.object({ endpoint }).safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'Invalid endpoint' }, { status: 400 })
        await getDb().delete(pushSubscriptions).where(andUserEndpoint(session.user.id, parsed.data.endpoint))
        return new Response(null, { status: 204 })
      },
    },
  },
})

function andUserEndpoint(userId: string, value: string) {
  return and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, value))
}
