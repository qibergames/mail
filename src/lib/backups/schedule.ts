import { and, eq, gte } from 'drizzle-orm'
import { getDb } from '@/db'
import { backups, backupSettings } from '@/db/schema'
import { newId } from '@/lib/ids'

export async function startScheduledBackup(env: CloudflareEnv, now = new Date()) {
  const settings = (await getDb(env.DB).select().from(backupSettings).where(eq(backupSettings.id, 'default')).limit(1)).at(0)
  if (!settings?.enabled) return
  if (settings.scheduleType === 'weekly' && now.getUTCDay() !== settings.scheduleValue) return
  if (settings.scheduleType === 'monthly' && now.getUTCDate() !== settings.scheduleValue) return
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if ((await getDb(env.DB).select({ id: backups.id }).from(backups).where(and(eq(backups.trigger, 'scheduled'), gte(backups.createdAt, dayStart))).limit(1)).length) return
  const id = newId('bak')
  await getDb(env.DB).insert(backups).values({ id, trigger: 'scheduled' })
  await env.DATABASE_BACKUP_WORKFLOW.create({ id, params: { backupId: id } })
}
