import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/db'
import { domains, folders, mailboxes, routingRules, users } from '@/db/schema'
import { requireSession } from '@/lib/api-auth'
import { newId } from '@/lib/ids'

const updateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('profile'), name: z.string().trim().min(1).max(100), resetEmail: z.email(), forwardingEmail: z.union([z.literal(''), z.email()]) }),
  z.object({ type: z.literal('mailbox'), mailboxId: z.string(), displayName: z.string().trim().max(100), signature: z.string().max(20_000), autoReplyEnabled: z.boolean(), autoReplySubject: z.string().max(998), autoReplyBody: z.string().max(100_000) }),
  z.object({ type: z.literal('folder'), mailboxId: z.string(), name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-f]{6}$/i) }),
  z.object({ type: z.literal('rule'), mailboxId: z.string(), name: z.string().trim().min(1).max(100), matchField: z.enum(['content', 'title', 'sender', 'recipient']), matchOperator: z.enum(['contains', 'exact', 'starts_with', 'ends_with', 'regex']), matchValue: z.string().min(1).max(500), action: z.enum(['store', 'spam', 'trash']), folderId: z.string().nullable() }),
])

export const Route = createFileRoute('/api/settings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request)
        const db = getDb()
        const [profile] = await db.select({
          name: users.name,
          email: users.email,
          resetEmail: users.resetEmail,
          forwardingEmail: users.forwardingEmail,
          role: users.role,
        }).from(users).where(eq(users.id, session.user.id)).limit(1)
        const boxes = await db.select({
          id: mailboxes.id,
          displayName: mailboxes.displayName,
          localPart: mailboxes.localPart,
          hostname: domains.hostname,
          signature: mailboxes.signature,
          autoReplyEnabled: mailboxes.autoReplyEnabled,
          autoReplySubject: mailboxes.autoReplySubject,
          autoReplyBody: mailboxes.autoReplyBody,
        }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)).where(eq(mailboxes.userId, session.user.id))
        const mailboxIds = boxes.map((box) => box.id)
        const boxFolders = mailboxIds.length
          ? await Promise.all(mailboxIds.map((mailboxId) => db.select().from(folders).where(eq(folders.mailboxId, mailboxId))))
          : []
        const boxRules = mailboxIds.length
          ? await Promise.all(mailboxIds.map((mailboxId) => db.select().from(routingRules).where(and(eq(routingRules.mailboxId, mailboxId), eq(routingRules.scope, 'mailbox')))))
          : []
        return Response.json({ profile, mailboxes: boxes, folders: boxFolders.flat(), rules: boxRules.flat() })
      },
      PATCH: async ({ request }) => {
        const session = await requireSession(request)
        const parsed = updateSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'Invalid settings' }, { status: 400 })
        const db = getDb()
        const input = parsed.data
        if (input.type === 'profile') {
          await db.update(users).set({
            name: input.name,
            resetEmail: input.resetEmail,
            forwardingEmail: input.forwardingEmail || null,
            updatedAt: new Date(),
          }).where(eq(users.id, session.user.id))
          return new Response(null, { status: 204 })
        }
        const owned = (await db.select({ id: mailboxes.id, domainId: mailboxes.domainId }).from(mailboxes).where(and(
          eq(mailboxes.id, input.mailboxId),
          eq(mailboxes.userId, session.user.id),
        )).limit(1)).at(0)
        if (!owned) return new Response('Forbidden', { status: 403 })
        if (input.type === 'mailbox') {
          await db.update(mailboxes).set({
            displayName: input.displayName || null,
            signature: input.signature || null,
            autoReplyEnabled: input.autoReplyEnabled,
            autoReplySubject: input.autoReplySubject,
            autoReplyBody: input.autoReplyBody,
          }).where(eq(mailboxes.id, owned.id))
        } else if (input.type === 'folder') {
          await db.insert(folders).values({ id: newId('fld'), userId: session.user.id, mailboxId: owned.id, name: input.name, color: input.color })
        } else {
          if (input.folderId) {
            const validFolder = (await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, input.folderId), eq(folders.mailboxId, owned.id))).limit(1)).at(0)
            if (!validFolder) return Response.json({ error: 'Invalid folder' }, { status: 400 })
          }
          await db.insert(routingRules).values({
            id: newId('rul'),
            userId: session.user.id,
            domainId: owned.domainId,
            mailboxId: owned.id,
            scope: 'mailbox',
            name: input.name,
            pattern: input.matchValue,
            matchField: input.matchField,
            matchOperator: input.matchOperator,
            matchValue: input.matchValue,
            action: input.action,
            folderId: input.action === 'store' ? input.folderId : null,
          })
        }
        return new Response(null, { status: 204 })
      },
      DELETE: async ({ request }) => {
        const session = await requireSession(request)
        const url = new URL(request.url)
        const kind = url.searchParams.get('kind')
        const id = url.searchParams.get('id')
        if (!id || !['folder', 'rule'].includes(kind ?? '')) return new Response('Bad request', { status: 400 })
        const db = getDb()
        if (kind === 'folder') {
          const row = (await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, id), eq(folders.userId, session.user.id))).limit(1)).at(0)
          if (!row) return new Response('Not found', { status: 404 })
          await db.delete(folders).where(eq(folders.id, id))
        } else {
          const row = (await db.select({ id: routingRules.id }).from(routingRules).where(and(eq(routingRules.id, id), eq(routingRules.userId, session.user.id), eq(routingRules.scope, 'mailbox'))).limit(1)).at(0)
          if (!row) return new Response('Not found', { status: 404 })
          await db.delete(routingRules).where(eq(routingRules.id, id))
        }
        return new Response(null, { status: 204 })
      },
    },
  },
})
