import { createFileRoute } from '@tanstack/react-router'
import { desc, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { getDb } from '@/db'
import { backups, backupSettings } from '@/db/schema'
import { requireAdmin } from '@/lib/api-auth'
import { restoreDatabase } from '@/lib/backups/data'
import { newId } from '@/lib/ids'

const settingsSchema = z.object({ enabled: z.boolean(), scheduleType: z.enum(['daily', 'weekly', 'monthly']), scheduleValue: z.number().int().min(0).max(31).nullable(), retentionEnabled: z.boolean(), retentionDays: z.number().int().min(1).max(3650) })

export const Route = createFileRoute('/api/backups')({ server: { handlers: {
  GET: async ({ request }) => {
    await requireAdmin(request)
    const settings = (await getDb().select().from(backupSettings).where(eq(backupSettings.id, 'default')).limit(1)).at(0)
    return Response.json({ settings: settings || null, backups: await getDb().select().from(backups).orderBy(desc(backups.createdAt)).limit(100) })
  },
  POST: async ({ request }) => {
    const session = await requireAdmin(request)
    const id = newId('bak')
    await getDb().insert(backups).values({ id, trigger: 'manual', createdByUserId: session.user.id })
    await env.DATABASE_BACKUP_WORKFLOW.create({ id, params: { backupId: id } })
    return Response.json({ id }, { status: 202 })
  },
  PATCH: async ({ request }) => {
    await requireAdmin(request)
    const input = settingsSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) return Response.json({ error: 'Invalid backup settings' }, { status: 400 })
    await getDb().insert(backupSettings).values({ id: 'default', ...input.data }).onConflictDoUpdate({ target: backupSettings.id, set: { ...input.data, updatedAt: new Date() } })
    return new Response(null, { status: 204 })
  },
  PUT: async ({ request }) => {
    await requireAdmin(request)
    if (Number(request.headers.get('content-length') ?? 0) > 50 * 1024 * 1024) return new Response('Backup too large', { status: 413 })
    await restoreDatabase(env.DB, await request.arrayBuffer())
    return new Response(null, { status: 204 })
  },
} } })
