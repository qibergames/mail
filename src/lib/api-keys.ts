import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import { apiKeys } from '@/db/schema'
import { newId } from '@/lib/ids'

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createApiKey(userId: string, name: string, scopes: Array<string>) {
  const key = `qbm_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
  await getDb().insert(apiKeys).values({ id: newId('key'), userId, name, prefix: key.slice(0, 12), keyHash: await digest(key), scopes: JSON.stringify(scopes) })
  return key
}

export async function authenticateApiKey(request: Request, scope: 'messages:read' | 'messages:send') {
  const authorization = request.headers.get('authorization')
  const key = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!key.startsWith('qbm_')) throw new Response('Unauthorized', { status: 401 })
  const row = (await getDb().select().from(apiKeys).where(eq(apiKeys.keyHash, await digest(key))).limit(1)).at(0)
  if (!row || !(JSON.parse(row.scopes) as Array<string>).includes(scope)) throw new Response('Forbidden', { status: 403 })
  await getDb().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id))
  return row
}
