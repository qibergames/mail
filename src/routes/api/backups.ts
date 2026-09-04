import { createFileRoute } from '@tanstack/react-router'
import { desc, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { getDb } from '@/db'
import { backups, backupSettings } from '@/db/schema'
import { requireAdmin } from '@/lib/api-auth'
import { restoreDatabase } from '@/lib/backups/data'
import { getBackupWorkflow } from '@/lib/backups/binding'
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
    let workflow
    try { workflow = getBackupWorkflow(env) } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Database backup workflow is not configured' }, { status: 503 })
    }
    const id = newId('bak')
    await getDb().insert(backups).values({ id, trigger: 'manual', createdByUserId: session.user.id })
    try {
      await workflow.create({ id: `database-backup-${id}`, params: { backupId: id } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start backup'
      await getDb().update(backups).set({ status: 'failed', error: message, completedAt: new Date() }).where(eq(backups.id, id))
      console.error('Backup workflow start failed', { backupId: id, error: message })
      return Response.json({ error: message }, { status: 500 })
    }
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
    try {
      await restoreDatabase(env.DB, await request.arrayBuffer())
      return new Response(null, { status: 204 })
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Restore failed' }, { status: 400 })
    }
  },
} } })
