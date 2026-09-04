import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { getDb } from '@/db'
import { apiKeys, calendarEvents, contacts, emailTemplates, webhookDeliveries, webhooks } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { createApiKey } from '@/lib/api-keys'
import { newId } from '@/lib/ids'
import { isPublicHttpsUrl } from '@/lib/public-url'
import type { WebhookQueueMessage } from '@/lib/webhooks'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('contact:create'), email: z.email(), displayName: z.string().trim().max(100), blocked: z.boolean().default(false) }),
  z.object({ action: z.literal('contact:block'), id: z.string(), blocked: z.boolean() }),
  z.object({ action: z.literal('template:create'), name: z.string().trim().min(1).max(100), subject: z.string().max(998), textBody: z.string().max(100_000) }),
  z.object({ action: z.literal('event:create'), mailboxId: z.string().nullable(), title: z.string().trim().min(1).max(200), description: z.string().max(20_000), location: z.string().max(500), attendees: z.array(z.email()).max(100), startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }),
  z.object({ action: z.literal('key:create'), name: z.string().trim().min(1).max(100), scopes: z.array(z.enum(['messages:read', 'messages:send'])).min(1) }),
  z.object({ action: z.literal('webhook:create'), description: z.string().trim().max(200), url: z.url().refine(isPublicHttpsUrl), events: z.array(z.enum(['message.received', 'message.sent'])).min(1), maxAttempts: z.number().int().min(1).max(10) }),
  z.object({ action: z.literal('webhook:test'), id: z.string() }),
])

export const Route = createFileRoute('/api/tools')({ server: { handlers: {
  GET: async ({ request }) => {
    const session = await requireSession(request)
    const db = getDb()
    const hooks = await db.select().from(webhooks).where(eq(webhooks.userId, session.user.id))
    const deliveries = (await Promise.all(hooks.map((hook) => db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id)).orderBy(desc(webhookDeliveries.createdAt)).limit(10)))).flat()
    return Response.json({
      contacts: await db.select().from(contacts).where(eq(contacts.userId, session.user.id)).orderBy(desc(contacts.lastSeenAt)),
      templates: await db.select().from(emailTemplates).where(eq(emailTemplates.userId, session.user.id)),
      events: await db.select().from(calendarEvents).where(eq(calendarEvents.userId, session.user.id)).orderBy(calendarEvents.startsAt),
      apiKeys: await db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt }).from(apiKeys).where(eq(apiKeys.userId, session.user.id)),
      webhooks: hooks,
      deliveries,
    })
  },
  POST: async ({ request }) => {
    const session = await requireSession(request)
    const parsed = actionSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Invalid tool action', details: parsed.error.flatten() }, { status: 400 })
    const input = parsed.data
    const db = getDb()
    if (input.action === 'contact:create') {
      await db.insert(contacts).values({ id: newId('con'), userId: session.user.id, email: input.email.toLowerCase(), displayName: input.displayName || null, source: 'manual', blocked: input.blocked }).onConflictDoUpdate({ target: [contacts.userId, contacts.email], set: { displayName: input.displayName || null, blocked: input.blocked } })
    } else if (input.action === 'contact:block') {
      await db.update(contacts).set({ blocked: input.blocked }).where(and(eq(contacts.id, input.id), eq(contacts.userId, session.user.id)))
    } else if (input.action === 'template:create') {
      await db.insert(emailTemplates).values({ id: newId('tpl'), userId: session.user.id, name: input.name, subject: input.subject, textBody: input.textBody })
    } else if (input.action === 'event:create') {
      const startsAt = new Date(input.startsAt); const endsAt = new Date(input.endsAt)
      if (endsAt <= startsAt) return Response.json({ error: 'Event must end after it starts' }, { status: 400 })
      await db.insert(calendarEvents).values({ id: newId('evt'), userId: session.user.id, mailboxId: input.mailboxId, title: input.title, description: input.description, location: input.location, attendees: JSON.stringify(input.attendees), startsAt, endsAt })
    } else if (input.action === 'key:create') {
      return Response.json({ key: await createApiKey(session.user.id, input.name, input.scopes) }, { status: 201 })
    } else if (input.action === 'webhook:create') {
      await db.insert(webhooks).values({ id: newId('whk'), userId: session.user.id, description: input.description || null, url: input.url, secret: crypto.randomUUID().replaceAll('-', ''), events: JSON.stringify(input.events), maxAttempts: input.maxAttempts })
    } else {
      const hook = (await db.select().from(webhooks).where(and(eq(webhooks.id, input.id), eq(webhooks.userId, session.user.id))).limit(1)).at(0)
      if (!hook) return new Response('Not found', { status: 404 })
      const deliveryId = newId('whd')
      await db.insert(webhookDeliveries).values({ id: deliveryId, webhookId: hook.id, eventType: 'test', payload: JSON.stringify({ event: 'test', sentAt: new Date().toISOString() }) })
      await env.OUTBOUND_QUEUE.send({ type: 'webhook', deliveryId } satisfies WebhookQueueMessage)
    }
    return Response.json({ ok: true })
  },
  DELETE: async ({ request }) => {
    const session = await requireSession(request)
    const url = new URL(request.url); const kind = url.searchParams.get('kind'); const id = url.searchParams.get('id')
    if (!id) return new Response('Bad request', { status: 400 })
    const table = kind === 'contact' ? contacts : kind === 'template' ? emailTemplates : kind === 'event' ? calendarEvents : kind === 'key' ? apiKeys : kind === 'webhook' ? webhooks : null
    if (!table) return new Response('Bad request', { status: 400 })
    await dbDeleteOwned(table, id, session.user.id)
    return new Response(null, { status: 204 })
  },
} } })

function dbDeleteOwned(table: typeof contacts | typeof emailTemplates | typeof calendarEvents | typeof apiKeys | typeof webhooks, id: string, userId: string) {
  return getDb().delete(table).where(and(eq(table.id, id), eq(table.userId, userId)))
}
