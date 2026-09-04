import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { getDb } from '@/db'
import { auditLogs, domains, mailboxAccess, mailboxAliases, mailboxes, routingRules, users } from '@/db/schema'
import { describeIssues, errorResponse, requireAdmin } from '@/lib/api-auth'
import { auth } from '@/lib/auth'
import { createMailboxRoute, deleteMailboxRoute, deleteMailboxRouteByAddress, deleteSendingSubdomain, provisionDomain } from '@/lib/cloudflare-api'
import { newId } from '@/lib/ids'
import { hostnameSchema as hostname, localPartSchema as localPart } from '@/lib/validation'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('user:create'), name: z.string().trim().min(1).max(100), localPart, domainId: z.string().min(1), password: z.string().min(12).max(128), role: z.enum(['admin', 'user']).default('user'), createMailbox: z.boolean().default(true) }),
  z.object({ action: z.literal('user:role'), userId: z.string(), role: z.enum(['admin', 'user']) }),
  z.object({ action: z.literal('user:ban'), userId: z.string(), banned: z.boolean() }),
  z.object({ action: z.literal('domain:create'), hostname }),
  z.object({ action: z.literal('mailbox:create'), userId: z.string(), domainId: z.string(), localPart, displayName: z.string().trim().max(100), mailboxType: z.enum(['personal', 'shared']) }),
  z.object({ action: z.literal('mailbox:update'), mailboxId: z.string(), userId: z.string(), domainId: z.string().min(1), localPart, displayName: z.string().trim().max(100), mailboxType: z.enum(['personal', 'shared']), disabled: z.boolean() }),
  z.object({ action: z.literal('mailbox:delete'), mailboxId: z.string() }),
  z.object({ action: z.literal('user:delete'), userId: z.string() }),
  z.object({ action: z.literal('alias:update'), aliasId: z.string(), mailboxId: z.string(), domainId: z.string(), localPart }),
  z.object({ action: z.literal('alias:delete'), aliasId: z.string() }),
  z.object({ action: z.literal('access:delete'), accessId: z.string() }),
  z.object({ action: z.literal('alias:create'), mailboxId: z.string(), domainId: z.string(), localPart }),
  z.object({ action: z.literal('access:set'), mailboxId: z.string(), userId: z.string(), permission: z.enum(['read_only', 'send_as', 'send_on_behalf', 'full_access']) }),
  z.object({ action: z.literal('rule:update'), ruleId: z.string(), mailboxId: z.string().nullable(), name: z.string().trim().min(1).max(100), pattern: z.string().min(1).max(500), actionType: z.enum(['store', 'forward', 'reject']), forwardTo: z.union([z.literal(''), z.email()]), keepCopy: z.boolean(), enabled: z.boolean() }),
  z.object({ action: z.literal('rule:toggle'), ruleId: z.string(), enabled: z.boolean() }),
  z.object({ action: z.literal('rule:delete'), ruleId: z.string() }),
  z.object({ action: z.literal('rule:create'), domainId: z.string(), mailboxId: z.string().nullable(), name: z.string().trim().min(1).max(100), pattern: z.string().min(1).max(500), actionType: z.enum(['store', 'forward', 'reject']), forwardTo: z.union([z.literal(''), z.email()]), keepCopy: z.boolean() }),
])

export const Route = createFileRoute('/api/admin')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await requireAdmin(request)
        const db = getDb()
        const [userRows, domainRows, mailboxRows, aliasRows, accessRows, rules, logs] = await Promise.all([
          db.select({ id: users.id, name: users.name, email: users.email, role: users.role, banned: users.banned, canManageMailboxes: users.canManageMailboxes }).from(users),
          db.select().from(domains),
          db.select({ id: mailboxes.id, userId: mailboxes.userId, domainId: mailboxes.domainId, localPart: mailboxes.localPart, displayName: mailboxes.displayName, type: mailboxes.type, disabled: mailboxes.disabled, hostname: domains.hostname }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)),
          db.select().from(mailboxAliases),
          db.select().from(mailboxAccess),
          db.select().from(routingRules).where(eq(routingRules.scope, 'domain')),
          db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100),
        ])
        return Response.json({ users: userRows, domains: domainRows, mailboxes: mailboxRows, aliases: aliasRows, access: accessRows, rules, logs })
      },
      POST: async ({ request }) => {
        const session = await requireAdmin(request)
        const parsed = actionSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: `Invalid admin action (${describeIssues(parsed.error)})`, details: parsed.error.flatten() }, { status: 400 })
        try {
          return await runAdminAction(request, session, parsed.data)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})

async function runAdminAction(request: Request, session: Awaited<ReturnType<typeof requireAdmin>>, input: z.infer<typeof actionSchema>) {
  const db = getDb()
  let result: unknown = null
  if (input.action === 'user:create') {
    const domain = (await db.select().from(domains).where(eq(domains.id, input.domainId)).limit(1)).at(0)
    if (!domain) return Response.json({ error: 'Unknown domain' }, { status: 400 })
    const address = `${input.localPart}@${domain.hostname}`
    if (input.createMailbox && (await db.select({ id: mailboxes.id }).from(mailboxes).where(and(eq(mailboxes.domainId, domain.id), eq(mailboxes.localPart, input.localPart))).limit(1)).length) return Response.json({ error: 'Mailbox already exists' }, { status: 409 })
    const created = await auth.api.createUser({ headers: request.headers, body: { name: input.name, email: address, password: input.password, role: input.role } })
    if (input.createMailbox) {
      const rule = await createMailboxRoute(env, domain.zoneId, address)
      try {
        await db.insert(mailboxes).values({ id: newId('mbx'), userId: created.user.id, domainId: domain.id, localPart: input.localPart, displayName: input.name, type: 'personal' })
      } catch (error) {
        await deleteMailboxRoute(env, domain.zoneId, rule.id).catch(console.warn)
        throw error
      }
    }
    result = { id: created.user.id, address }
  } else if (input.action === 'user:role') {
    if (input.userId === session.user.id && input.role !== 'admin') return Response.json({ error: 'Cannot demote yourself' }, { status: 400 })
    result = await auth.api.setRole({ headers: request.headers, body: { userId: input.userId, role: input.role } })
  } else if (input.action === 'user:ban') {
    if (input.userId === session.user.id) return Response.json({ error: 'Cannot ban yourself' }, { status: 400 })
    result = input.banned
      ? await auth.api.banUser({ headers: request.headers, body: { userId: input.userId, banReason: 'Disabled by administrator' } })
      : await auth.api.unbanUser({ headers: request.headers, body: { userId: input.userId } })
  } else if (input.action === 'domain:create') {
    if ((await db.select({ id: domains.id }).from(domains).where(eq(domains.hostname, input.hostname)).limit(1)).length) return Response.json({ error: 'Domain already exists' }, { status: 409 })
    const provisioned = await provisionDomain(env, input.hostname)
    try {
      const id = newId('dom')
      await db.insert(domains).values({ id, userId: session.user.id, hostname: provisioned.hostname, zoneId: provisioned.zoneId, status: 'active', routingStatus: provisioned.routingStatus, routingEnabled: provisioned.routingEnabled, sendingEnabled: provisioned.sendingEnabled, sendingSubdomainTag: provisioned.sendingSubdomainTag })
      result = { id }
    } catch (error) {
      if (provisioned.sendingCreated && provisioned.sendingSubdomainTag) await deleteSendingSubdomain(env, provisioned.zoneId, provisioned.sendingSubdomainTag).catch(console.warn)
      throw error
    }
  } else if (input.action === 'mailbox:create') {
    const domain = (await db.select().from(domains).where(eq(domains.id, input.domainId)).limit(1)).at(0)
    if (!domain || !(await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1)).length) return Response.json({ error: 'Unknown user or domain' }, { status: 400 })
    const address = `${input.localPart}@${domain.hostname}`
    const rule = await createMailboxRoute(env, domain.zoneId, address)
    try {
      const id = newId('mbx')
      await db.insert(mailboxes).values({ id, userId: input.userId, domainId: domain.id, localPart: input.localPart, displayName: input.displayName || null, type: input.mailboxType })
      result = { id, address }
    } catch (error) {
      await deleteMailboxRoute(env, domain.zoneId, rule.id).catch(console.warn)
      throw error
    }
  } else if (input.action === 'mailbox:update') {
    if (!(await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1)).length) return Response.json({ error: 'Unknown user' }, { status: 400 })
    const current = (await db.select({ id: mailboxes.id, userId: mailboxes.userId, domainId: mailboxes.domainId, localPart: mailboxes.localPart, hostname: domains.hostname, zoneId: domains.zoneId }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(eq(mailboxes.id, input.mailboxId)).limit(1)).at(0)
    if (!current) return Response.json({ error: 'Unknown mailbox' }, { status: 404 })
    const target = (await db.select({ id: domains.id, hostname: domains.hostname, zoneId: domains.zoneId }).from(domains).where(eq(domains.id, input.domainId)).limit(1)).at(0)
    if (!target) return Response.json({ error: 'Unknown domain' }, { status: 400 })
    const moved = current.domainId !== target.id || current.localPart !== input.localPart
    const oldAddress = `${current.localPart}@${current.hostname}`
    const newAddress = `${input.localPart}@${target.hostname}`
    if (moved) {
      if ((await db.select({ id: mailboxes.id }).from(mailboxes).where(and(eq(mailboxes.domainId, target.id), eq(mailboxes.localPart, input.localPart))).limit(1)).length) return Response.json({ error: 'Mailbox already exists' }, { status: 409 })
      if ((await db.select({ id: mailboxAliases.id }).from(mailboxAliases).where(and(eq(mailboxAliases.domainId, target.id), eq(mailboxAliases.localPart, input.localPart))).limit(1)).length) return Response.json({ error: 'An alias already uses this address' }, { status: 409 })
      const rule = await createMailboxRoute(env, target.zoneId, newAddress)
      try {
        await db.update(mailboxes).set({ userId: input.userId, domainId: target.id, localPart: input.localPart, displayName: input.displayName || null, type: input.mailboxType, disabled: input.disabled }).where(eq(mailboxes.id, current.id))
      } catch (error) {
        await deleteMailboxRoute(env, target.zoneId, rule.id).catch(console.warn)
        throw error
      }
      await deleteMailboxRouteByAddress(env, current.zoneId, oldAddress).catch(console.warn)
      const owner = (await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, current.userId)).limit(1)).at(0)
      if (owner && owner.email.toLowerCase() === oldAddress.toLowerCase()) await db.update(users).set({ email: newAddress, updatedAt: new Date() }).where(eq(users.id, owner.id))
    } else {
      await db.update(mailboxes).set({ userId: input.userId, displayName: input.displayName || null, type: input.mailboxType, disabled: input.disabled }).where(eq(mailboxes.id, current.id))
    }
    result = { id: current.id, address: newAddress }
  } else if (input.action === 'mailbox:delete') {
    const mailbox = (await db.select({ id: mailboxes.id, localPart: mailboxes.localPart, hostname: domains.hostname, zoneId: domains.zoneId }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(eq(mailboxes.id, input.mailboxId)).limit(1)).at(0)
    if (!mailbox) return Response.json({ error: 'Unknown mailbox' }, { status: 404 })
    const aliases = await db.select({ localPart: mailboxAliases.localPart, hostname: domains.hostname, zoneId: domains.zoneId }).from(mailboxAliases).innerJoin(domains, eq(mailboxAliases.domainId, domains.id)).where(eq(mailboxAliases.mailboxId, mailbox.id))
    await db.delete(mailboxes).where(eq(mailboxes.id, mailbox.id))
    for (const item of [mailbox, ...aliases]) await deleteMailboxRouteByAddress(env, item.zoneId, `${item.localPart}@${item.hostname}`).catch(console.warn)
  } else if (input.action === 'user:delete') {
    if (input.userId === session.user.id) return Response.json({ error: 'Cannot delete yourself' }, { status: 400 })
    const owned = await db.select({ localPart: mailboxes.localPart, hostname: domains.hostname, zoneId: domains.zoneId, id: mailboxes.id }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(eq(mailboxes.userId, input.userId))
    const ownedAliases = owned.length ? await db.select({ localPart: mailboxAliases.localPart, hostname: domains.hostname, zoneId: domains.zoneId }).from(mailboxAliases).innerJoin(domains, eq(mailboxAliases.domainId, domains.id)).where(inArray(mailboxAliases.mailboxId, owned.map((item) => item.id))) : []
    result = await auth.api.removeUser({ headers: request.headers, body: { userId: input.userId } })
    for (const item of [...owned, ...ownedAliases]) await deleteMailboxRouteByAddress(env, item.zoneId, `${item.localPart}@${item.hostname}`).catch(console.warn)
  } else if (input.action === 'alias:update') {
    const current = (await db.select({ id: mailboxAliases.id, domainId: mailboxAliases.domainId, localPart: mailboxAliases.localPart, hostname: domains.hostname, zoneId: domains.zoneId }).from(mailboxAliases).innerJoin(domains, eq(mailboxAliases.domainId, domains.id)).where(eq(mailboxAliases.id, input.aliasId)).limit(1)).at(0)
    if (!current) return Response.json({ error: 'Unknown alias' }, { status: 404 })
    const target = (await db.select({ id: domains.id, hostname: domains.hostname, zoneId: domains.zoneId }).from(domains).where(eq(domains.id, input.domainId)).limit(1)).at(0)
    if (!target || !(await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.id, input.mailboxId)).limit(1)).length) return Response.json({ error: 'Unknown mailbox or domain' }, { status: 400 })
    const moved = current.domainId !== target.id || current.localPart !== input.localPart
    if (moved) {
      if ((await db.select({ id: mailboxes.id }).from(mailboxes).where(and(eq(mailboxes.domainId, target.id), eq(mailboxes.localPart, input.localPart))).limit(1)).length) return Response.json({ error: 'Mailbox already exists' }, { status: 409 })
      if ((await db.select({ id: mailboxAliases.id }).from(mailboxAliases).where(and(eq(mailboxAliases.domainId, target.id), eq(mailboxAliases.localPart, input.localPart))).limit(1)).length) return Response.json({ error: 'An alias already uses this address' }, { status: 409 })
      const rule = await createMailboxRoute(env, target.zoneId, `${input.localPart}@${target.hostname}`)
      try {
        await db.update(mailboxAliases).set({ mailboxId: input.mailboxId, domainId: target.id, localPart: input.localPart }).where(eq(mailboxAliases.id, current.id))
      } catch (error) {
        await deleteMailboxRoute(env, target.zoneId, rule.id).catch(console.warn)
        throw error
      }
      await deleteMailboxRouteByAddress(env, current.zoneId, `${current.localPart}@${current.hostname}`).catch(console.warn)
    } else {
      await db.update(mailboxAliases).set({ mailboxId: input.mailboxId }).where(eq(mailboxAliases.id, current.id))
    }
  } else if (input.action === 'alias:delete') {
    const alias = (await db.select({ id: mailboxAliases.id, localPart: mailboxAliases.localPart, hostname: domains.hostname, zoneId: domains.zoneId }).from(mailboxAliases).innerJoin(domains, eq(mailboxAliases.domainId, domains.id)).where(eq(mailboxAliases.id, input.aliasId)).limit(1)).at(0)
    if (!alias) return Response.json({ error: 'Unknown alias' }, { status: 404 })
    await db.delete(mailboxAliases).where(eq(mailboxAliases.id, alias.id))
    await deleteMailboxRouteByAddress(env, alias.zoneId, `${alias.localPart}@${alias.hostname}`).catch(console.warn)
  } else if (input.action === 'access:delete') {
    const deleted = await db.delete(mailboxAccess).where(eq(mailboxAccess.id, input.accessId)).returning({ id: mailboxAccess.id })
    if (!deleted.length) return Response.json({ error: 'Unknown access grant' }, { status: 404 })
  } else if (input.action === 'alias:create') {
    const domain = (await db.select().from(domains).where(eq(domains.id, input.domainId)).limit(1)).at(0)
    const mailbox = (await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.id, input.mailboxId)).limit(1)).at(0)
    if (!domain || !mailbox) return Response.json({ error: 'Unknown mailbox or domain' }, { status: 400 })
    const address = `${input.localPart}@${domain.hostname}`
    const rule = await createMailboxRoute(env, domain.zoneId, address)
    try {
      const id = newId('als')
      await db.insert(mailboxAliases).values({ id, mailboxId: mailbox.id, domainId: domain.id, localPart: input.localPart })
      result = { id, address }
    } catch (error) {
      await deleteMailboxRoute(env, domain.zoneId, rule.id).catch(console.warn)
      throw error
    }
  } else if (input.action === 'access:set') {
    const mailbox = (await db.select({ userId: mailboxes.userId }).from(mailboxes).where(eq(mailboxes.id, input.mailboxId)).limit(1)).at(0)
    if (!mailbox || mailbox.userId === input.userId) return Response.json({ error: 'Invalid mailbox access' }, { status: 400 })
    await db.insert(mailboxAccess).values({ id: newId('acc'), mailboxId: input.mailboxId, userId: input.userId, permission: input.permission, createdByUserId: session.user.id }).onConflictDoUpdate({ target: [mailboxAccess.mailboxId, mailboxAccess.userId], set: { permission: input.permission, createdByUserId: session.user.id } })
  } else if (input.action === 'rule:toggle') {
    const updated = await db.update(routingRules).set({ enabled: input.enabled }).where(and(eq(routingRules.id, input.ruleId), eq(routingRules.scope, 'domain'))).returning({ id: routingRules.id })
    if (!updated.length) return Response.json({ error: 'Unknown rule' }, { status: 404 })
  } else if (input.action === 'rule:delete') {
    const deleted = await db.delete(routingRules).where(and(eq(routingRules.id, input.ruleId), eq(routingRules.scope, 'domain'))).returning({ id: routingRules.id })
    if (!deleted.length) return Response.json({ error: 'Unknown rule' }, { status: 404 })
  } else if (input.action === 'rule:update') {
    if (input.actionType === 'store' && !input.mailboxId) return Response.json({ error: 'Choose a mailbox to deliver to' }, { status: 400 })
    if (input.actionType === 'forward' && !input.forwardTo) return Response.json({ error: 'Choose an address to forward to' }, { status: 400 })
    if (input.mailboxId && !(await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.id, input.mailboxId)).limit(1)).length) return Response.json({ error: 'Invalid mailbox' }, { status: 400 })
    const updated = await db.update(routingRules).set({ mailboxId: input.mailboxId, name: input.name, pattern: input.pattern, matchValue: input.pattern, action: input.actionType, forwardTo: input.actionType === 'forward' ? input.forwardTo : null, keepCopy: input.keepCopy, enabled: input.enabled }).where(and(eq(routingRules.id, input.ruleId), eq(routingRules.scope, 'domain'))).returning({ id: routingRules.id })
    if (!updated.length) return Response.json({ error: 'Unknown rule' }, { status: 404 })
  } else {
    const domain = (await db.select({ id: domains.id }).from(domains).where(eq(domains.id, input.domainId)).limit(1)).at(0)
    if (!domain) return Response.json({ error: 'Unknown domain' }, { status: 400 })
    if (input.actionType === 'store' && !input.mailboxId) return Response.json({ error: 'Choose a mailbox to deliver to' }, { status: 400 })
    if (input.actionType === 'forward' && !input.forwardTo) return Response.json({ error: 'Choose an address to forward to' }, { status: 400 })
    if (input.mailboxId && !(await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.id, input.mailboxId)).limit(1)).length) return Response.json({ error: 'Invalid mailbox' }, { status: 400 })
    const id = newId('rul')
    await db.insert(routingRules).values({ id, userId: session.user.id, domainId: input.domainId, mailboxId: input.mailboxId, scope: 'domain', name: input.name, pattern: input.pattern, matchField: 'email', matchOperator: 'contains', matchValue: input.pattern, action: input.actionType, forwardTo: input.actionType === 'forward' ? input.forwardTo : null, keepCopy: input.keepCopy })
    result = { id }
  }
  await db.insert(auditLogs).values({ id: newId('log'), actorUserId: session.user.id, action: input.action, metadata: JSON.stringify(input.action.startsWith('user:') ? { userId: 'userId' in input ? input.userId : undefined } : input) })
  return Response.json(result ?? { ok: true })
}
