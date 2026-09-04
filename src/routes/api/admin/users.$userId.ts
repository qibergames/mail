import { createFileRoute } from '@tanstack/react-router'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { getDb } from '@/db'
import { auditLogs, domains, mailboxAccess, mailboxAliases, mailboxes, users } from '@/db/schema'
import { describeIssues, errorResponse, requireAdmin } from '@/lib/api-auth'
import { createMailboxRoute, deleteMailboxRoute, deleteMailboxRouteByAddress } from '@/lib/cloudflare-api'
import { newId } from '@/lib/ids'
import { localPartSchema } from '@/lib/validation'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('profile'), name: z.string().trim().min(1).max(100), email: z.email(), resetEmail: z.union([z.literal(''), z.email()]), forwardingEmail: z.union([z.literal(''), z.email()]), canManageMailboxes: z.boolean() }),
  z.object({ action: z.literal('primary'), mailboxId: z.string() }),
  z.object({ action: z.literal('mailbox:update'), mailboxId: z.string(), displayName: z.string().trim().max(100), type: z.enum(['personal', 'shared']), disabled: z.boolean() }),
  z.object({ action: z.literal('alias:create'), mailboxId: z.string(), domainId: z.string(), localPart: localPartSchema }),
  z.object({ action: z.literal('alias:delete'), aliasId: z.string() }),
])

async function loadUser(userId: string) {
  const db = getDb()
  const user = (await db.select({ id: users.id, name: users.name, email: users.email, resetEmail: users.resetEmail, forwardingEmail: users.forwardingEmail, role: users.role, banned: users.banned, canManageMailboxes: users.canManageMailboxes, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1)).at(0)
  if (!user) return null
  const mailboxRows = await db.select({ id: mailboxes.id, domainId: mailboxes.domainId, localPart: mailboxes.localPart, hostname: domains.hostname, displayName: mailboxes.displayName, type: mailboxes.type, disabled: mailboxes.disabled, createdAt: mailboxes.createdAt }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(eq(mailboxes.userId, user.id))
  const mailboxIds = mailboxRows.map((row) => row.id)
  const [aliasRows, accessRows, domainRows, logs] = await Promise.all([
    mailboxIds.length ? db.select({ id: mailboxAliases.id, mailboxId: mailboxAliases.mailboxId, localPart: mailboxAliases.localPart, hostname: domains.hostname }).from(mailboxAliases).innerJoin(domains, eq(mailboxAliases.domainId, domains.id)).where(inArray(mailboxAliases.mailboxId, mailboxIds)) : Promise.resolve([]),
    db.select({ id: mailboxAccess.id, mailboxId: mailboxAccess.mailboxId, permission: mailboxAccess.permission, localPart: mailboxes.localPart, hostname: domains.hostname }).from(mailboxAccess).innerJoin(mailboxes, eq(mailboxAccess.mailboxId, mailboxes.id)).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(eq(mailboxAccess.userId, user.id)),
    db.select({ id: domains.id, hostname: domains.hostname }).from(domains),
    db.select().from(auditLogs).where(eq(auditLogs.actorUserId, user.id)).orderBy(desc(auditLogs.createdAt)).limit(20),
  ])
  return { user, mailboxes: mailboxRows, aliases: aliasRows, access: accessRows, domains: domainRows, logs }
}

export const Route = createFileRoute('/api/admin/users/$userId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        await requireAdmin(request)
        const details = await loadUser(params.userId)
        return details ? Response.json(details) : Response.json({ error: 'Unknown user' }, { status: 404 })
      },
      POST: async ({ request, params }) => {
        const session = await requireAdmin(request)
        const parsed = actionSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: `Invalid admin action (${describeIssues(parsed.error)})`, details: parsed.error.flatten() }, { status: 400 })
        try {
          return await runUserAction(params.userId, session.user.id, parsed.data)
        } catch (error) {
          return errorResponse(error)
        }
      },
    },
  },
})

async function runUserAction(userId: string, actorId: string, input: z.infer<typeof actionSchema>) {
  const db = getDb()
  const user = (await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1)).at(0)
  if (!user) return Response.json({ error: 'Unknown user' }, { status: 404 })
  const ownMailbox = async (mailboxId: string) => (await db.select({ id: mailboxes.id, domainId: mailboxes.domainId, localPart: mailboxes.localPart, hostname: domains.hostname, zoneId: domains.zoneId }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.userId, user.id))).limit(1)).at(0)

  if (input.action === 'profile') {
    const email = input.email.toLowerCase()
    const taken = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)).at(0)
    if (taken && taken.id !== user.id) return Response.json({ error: 'Email already in use' }, { status: 409 })
    await db.update(users).set({ name: input.name, email, resetEmail: input.resetEmail || null, forwardingEmail: input.forwardingEmail || null, canManageMailboxes: input.canManageMailboxes, updatedAt: new Date() }).where(eq(users.id, user.id))
  } else if (input.action === 'primary') {
    const mailbox = await ownMailbox(input.mailboxId)
    if (!mailbox) return Response.json({ error: 'Invalid mailbox' }, { status: 400 })
    const email = `${mailbox.localPart}@${mailbox.hostname}`
    const taken = (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)).at(0)
    if (taken && taken.id !== user.id) return Response.json({ error: 'Email already in use' }, { status: 409 })
    await db.update(users).set({ email, updatedAt: new Date() }).where(eq(users.id, user.id))
  } else if (input.action === 'mailbox:update') {
    if (!(await ownMailbox(input.mailboxId))) return Response.json({ error: 'Invalid mailbox' }, { status: 400 })
    await db.update(mailboxes).set({ displayName: input.displayName || null, type: input.type, disabled: input.disabled }).where(eq(mailboxes.id, input.mailboxId))
  } else if (input.action === 'alias:create') {
    const mailbox = await ownMailbox(input.mailboxId)
    const domain = (await db.select().from(domains).where(eq(domains.id, input.domainId)).limit(1)).at(0)
    if (!mailbox || !domain) return Response.json({ error: 'Unknown mailbox or domain' }, { status: 400 })
    const address = `${input.localPart}@${domain.hostname}`
    const rule = await createMailboxRoute(env, domain.zoneId, address)
    try {
      await db.insert(mailboxAliases).values({ id: newId('als'), mailboxId: mailbox.id, domainId: domain.id, localPart: input.localPart })
    } catch (error) {
      await deleteMailboxRoute(env, domain.zoneId, rule.id).catch(console.warn)
      throw error
    }
  } else {
    const alias = (await db.select({ id: mailboxAliases.id, localPart: mailboxAliases.localPart, hostname: domains.hostname, zoneId: domains.zoneId, ownerId: mailboxes.userId }).from(mailboxAliases).innerJoin(domains, eq(mailboxAliases.domainId, domains.id)).innerJoin(mailboxes, eq(mailboxAliases.mailboxId, mailboxes.id)).where(eq(mailboxAliases.id, input.aliasId)).limit(1)).at(0)
    if (!alias || alias.ownerId !== user.id) return Response.json({ error: 'Unknown alias' }, { status: 400 })
    await db.delete(mailboxAliases).where(eq(mailboxAliases.id, alias.id))
    await deleteMailboxRouteByAddress(env, alias.zoneId, `${alias.localPart}@${alias.hostname}`).catch(console.warn)
  }
  await db.insert(auditLogs).values({ id: newId('log'), actorUserId: actorId, action: `user:${input.action}`, metadata: JSON.stringify({ userId: user.id, ...input }) })
  return Response.json(await loadUser(user.id))
}
