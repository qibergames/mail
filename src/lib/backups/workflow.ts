import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { and, eq, inArray, lt } from 'drizzle-orm'
import { getDb } from '@/db'
import { backups, backupSettings } from '@/db/schema'
import { exportDatabase } from './data'

export type BackupWorkflowParams = { backupId?: string }

export class DatabaseBackupWorkflow extends WorkflowEntrypoint<CloudflareEnv, BackupWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<BackupWorkflowParams>>, step: WorkflowStep) {
    const backupId = event.payload.backupId
    if (!backupId) return { skipped: true }
    try {
      await step.do('Mark backup running', async () => { await getDb(this.env.DB).update(backups).set({ status: 'running', startedAt: new Date() }).where(eq(backups.id, backupId)) })
      const stored = await step.do('Export D1 to R2', async () => {
        const content = await exportDatabase(this.env.DB)
        const filename = `qibermail-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        const r2Key = `backups/${backupId}/${filename}`
        await this.env.BUCKET.put(r2Key, content, { httpMetadata: { contentType: 'application/json' }, customMetadata: { backupId } })
        return { filename, r2Key, size: content.byteLength }
      })
      await step.do('Mark backup complete', async () => { await getDb(this.env.DB).update(backups).set({ status: 'completed', ...stored, completedAt: new Date(), error: null }).where(eq(backups.id, backupId)) })
      await step.do('Apply retention', async () => {
        const settings = (await getDb(this.env.DB).select().from(backupSettings).where(eq(backupSettings.id, 'default')).limit(1)).at(0)
        if (!settings?.retentionEnabled) return
        const expired = await getDb(this.env.DB).select().from(backups).where(and(lt(backups.createdAt, new Date(Date.now() - settings.retentionDays * 86_400_000)), inArray(backups.status, ['completed', 'failed'])))
        for (const backup of expired) {
          if (backup.r2Key) await this.env.BUCKET.delete(backup.r2Key)
          await getDb(this.env.DB).delete(backups).where(eq(backups.id, backup.id))
        }
      })
      return { backupId, ...stored }
    } catch (error) {
      await getDb(this.env.DB).update(backups).set({ status: 'failed', error: error instanceof Error ? error.message : 'Backup failed', completedAt: new Date() }).where(eq(backups.id, backupId))
      throw error
    }
  }
}
