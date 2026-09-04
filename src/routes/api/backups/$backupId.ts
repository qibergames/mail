import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { getDb } from '@/db'
import { backups } from '@/db/schema'
import { requireAdmin } from '@/lib/api-auth'

export const Route = createFileRoute('/api/backups/$backupId')({ server: { handlers: { GET: async ({ request, params }) => {
  await requireAdmin(request)
  const backup = (await getDb().select().from(backups).where(eq(backups.id, params.backupId)).limit(1)).at(0)
  if (!backup?.r2Key) return new Response('Not found', { status: 404 })
  const object = await env.BUCKET.get(backup.r2Key)
  if (!object) return new Response('Not found', { status: 404 })
  return new Response(object.body, { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${backup.filename ?? 'qibermail-backup.json'}"`, 'Cache-Control': 'private, no-store' } })
} } } })
