import { createFileRoute } from '@tanstack/react-router'
import { and, count, desc, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { getDb } from '@/db'
import { auditLogs, domains, mailboxAliases, mailboxes, messages, outboundJobs, routingRules, users } from '@/db/schema'
import { errorResponse, requireAdmin } from '@/lib/api-auth'
import { enableSending, inspectDomain } from '@/lib/cloudflare-api'
import { newId } from '@/lib/ids'

async function loadDomain(domainId: string) {
  const db = getDb()
  const domain = (await db.select().from(domains).where(eq(domains.id, domainId)).limit(1)).at(0)
  if (!domain) return null
  const [mailboxRows, aliasRows, ruleRows, counts, lastInbound, lastOutbound, failed] = await Promise.all([
    db.select({ id: mailboxes.id, localPart: mailboxes.localPart, displayName: mailboxes.displayName, type: mailboxes.type, disabled: mailboxes.disabled, owner: users.name }).from(mailboxes).innerJoin(users, eq(mailboxes.userId, users.id)).where(eq(mailboxes.domainId, domain.id)),
    db.select({ id: mailboxAliases.id, localPart: mailboxAliases.localPart, mailboxId: mailboxAliases.mailboxId }).from(mailboxAliases).where(eq(mailboxAliases.domainId, domain.id)),
    db.select({ id: routingRules.id, name: routingRules.name, pattern: routingRules.pattern, action: routingRules.action, forwardTo: routingRules.forwardTo, enabled: routingRules.enabled, matchCount: routingRules.matchCount }).from(routingRules).where(and(eq(routingRules.domainId, domain.id), eq(routingRules.scope, 'domain'))),
    db.select({ direction: messages.direction, total: count() }).from(messages).innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id)).where(eq(mailboxes.domainId, domain.id)).groupBy(messages.direction),
    db.select({ createdAt: messages.createdAt }).from(messages).innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id)).where(and(eq(mailboxes.domainId, domain.id), eq(messages.direction, 'inbound'))).orderBy(desc(messages.createdAt)).limit(1),
    db.select({ createdAt: messages.createdAt }).from(messages).innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id)).where(and(eq(mailboxes.domainId, domain.id), eq(messages.direction, 'outbound'))).orderBy(desc(messages.createdAt)).limit(1),
    db.select({ total: count() }).from(outboundJobs).innerJoin(messages, eq(outboundJobs.messageId, messages.id)).innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id)).where(and(eq(mailboxes.domainId, domain.id), eq(outboundJobs.status, 'failed'))),
  ])
  const cloudflare = await inspectDomain(env, domain.zoneId, domain.hostname).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }))
  return {
    domain,
    mailboxes: mailboxRows,
    aliases: aliasRows,
    rules: ruleRows,
    stats: {
      inbound: counts.find((row) => row.direction === 'inbound')?.total ?? 0,
      outbound: counts.find((row) => row.direction === 'outbound')?.total ?? 0,
      failedJobs: failed.at(0)?.total ?? 0,
      lastInboundAt: lastInbound.at(0)?.createdAt ?? null,
      lastOutboundAt: lastOutbound.at(0)?.createdAt ?? null,
    },
    cloudflare: 'error' in cloudflare ? null : cloudflare,
    cloudflareError: 'error' in cloudflare ? cloudflare.error : null,
  }
}

export const Route = createFileRoute('/api/admin/domains/$domainId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        await requireAdmin(request)
        const details = await loadDomain(params.domainId)
        return details ? Response.json(details) : Response.json({ error: 'Unknown domain' }, { status: 404 })
      },
      DELETE: async ({ request, params }) => {
        const session = await requireAdmin(request)
        const db = getDb()
        const domain = (await db.select({ id: domains.id, hostname: domains.hostname }).from(domains).where(eq(domains.id, params.domainId)).limit(1)).at(0)
        if (!domain) return Response.json({ error: 'Unknown domain' }, { status: 404 })
        if ((await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.domainId, domain.id)).limit(1)).length) return Response.json({ error: 'Delete or move the mailboxes on this domain first' }, { status: 409 })
        if ((await db.select({ id: mailboxAliases.id }).from(mailboxAliases).where(eq(mailboxAliases.domainId, domain.id)).limit(1)).length) return Response.json({ error: 'Delete the aliases on this domain first' }, { status: 409 })
        await db.delete(domains).where(eq(domains.id, domain.id))
        await db.insert(auditLogs).values({ id: newId('log'), actorUserId: session.user.id, action: 'domain:delete', metadata: JSON.stringify({ domainId: domain.id, hostname: domain.hostname }) })
        return Response.json({ ok: true })
      },
      POST: async ({ request, params }) => {
        try {
          return await syncDomain(request, params.domainId)
        } catch (error) {
          return errorResponse(error, 502)
        }
      },
    },
  },
})

async function syncDomain(request: Request, domainId: string) {
  const session = await requireAdmin(request)
  const db = getDb()
  const domain = (await db.select().from(domains).where(eq(domains.id, domainId)).limit(1)).at(0)
  if (!domain) return Response.json({ error: 'Unknown domain' }, { status: 404 })
  const body = await request.json<{ action?: string }>().catch((): { action?: string } => ({}))
  const action = body.action === 'sending:enable' ? 'sending:enable' : 'sync'
  if (action === 'sending:enable') {
    try { await enableSending(env, domain.zoneId, domain.hostname) } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Cloudflare API request failed' }, { status: 502 }) }
  }
  const inspection = await inspectDomain(env, domain.zoneId, domain.hostname)
  if (!inspection.routing) return Response.json({ error: inspection.errors.join('; ') || 'Cloudflare API request failed' }, { status: 502 })
  const routingEnabled = inspection.routing.enabled
  const sendingEnabled = inspection.sending?.enabled ?? domain.sendingEnabled
  const status = inspection.routing.status === 'ready' && routingEnabled ? 'active' : inspection.routing.status === 'misconfigured' ? 'error' : 'pending'
  await db.update(domains).set({ routingEnabled, routingStatus: inspection.routing.status, sendingEnabled, sendingSubdomainTag: inspection.sending?.tag ?? domain.sendingSubdomainTag, status }).where(eq(domains.id, domain.id))
  await db.insert(auditLogs).values({ id: newId('log'), actorUserId: session.user.id, action: `domain:${action}`, metadata: JSON.stringify({ domainId: domain.id, status, routingEnabled, sendingEnabled }) })
  return Response.json(await loadDomain(domain.id))
}
