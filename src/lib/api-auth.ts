import { auth } from './auth'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import { users } from '@/db/schema'

export async function requireSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) throw new Response('Unauthorized', { status: 401 })
  return session
}

export async function requireAdmin(request: Request) {
  const session = await requireSession(request)
  const user = (await getDb().select({ role: users.role, banned: users.banned }).from(users).where(eq(users.id, session.user.id)).limit(1)).at(0)
  if (!user || user.banned || user.role !== 'admin') throw new Response('Forbidden', { status: 403 })
  return session
}
