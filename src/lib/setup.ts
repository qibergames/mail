import { and, eq } from 'drizzle-orm'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { getDb } from '@/db'
import { appSettings, domains, mailboxes, users } from '@/db/schema'
import { auth } from '@/lib/auth'
import {
  createMailboxRoute,
  deleteMailboxRoute,
  deleteSendingSubdomain,
  provisionDomain,
} from '@/lib/cloudflare-api'
import { newId } from '@/lib/ids'
import { verifyTurnstile } from '@/lib/turnstile'

const setupSchema = z.object({
  domain: z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  name: z.string().trim().min(1).max(100),
  resetEmail: z.email(),
  password: z.string().min(12).max(128),
  turnstileToken: z.string().max(2048).optional(),
})

export async function hasAdmin() {
  const [admin] = await getDb().select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1)
  return Boolean(admin)
}

export async function runSetup(request: Request) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return Response.json({ error: 'invalid_content_type' }, { status: 415 })
  }
  if (Number(request.headers.get('content-length') ?? 0) > 16_384) {
    return Response.json({ error: 'body_too_large' }, { status: 413 })
  }

  const parsed = setupSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid_setup', details: parsed.error.flatten() }, { status: 400 })
  if (!(await verifyTurnstile(request, parsed.data.turnstileToken))) {
    return Response.json({ error: 'verification_failed' }, { status: 400 })
  }

  const db = getDb()
  const lock = await db
    .insert(appSettings)
    .values({ id: 'default', appName: 'QiberMail' })
    .onConflictDoNothing()
    .returning({ id: appSettings.id })
  if (!lock.length || await hasAdmin()) {
    return Response.json({ error: 'registration_closed' }, { status: 403 })
  }

  const address = `${parsed.data.username}@${parsed.data.domain}`
  let userId: string | undefined
  let zoneId: string | undefined
  let routeId: string | undefined
  let sendingTag: string | undefined
  let sendingCreated = false

  try {
    const signUp = await auth.api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: address,
        password: parsed.data.password,
        resetEmail: parsed.data.resetEmail,
      },
      asResponse: true,
    })
    if (!signUp.ok) {
      await db.delete(appSettings).where(eq(appSettings.id, 'default'))
      return signUp
    }

    const payload = await signUp.clone().json<{ user?: { id: string } }>()
    userId = payload.user?.id
    if (!userId) throw new Error('Better Auth did not return the created user')
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, userId))

    const provisioned = await provisionDomain(env, parsed.data.domain)
    zoneId = provisioned.zoneId
    sendingTag = provisioned.sendingSubdomainTag ?? undefined
    sendingCreated = provisioned.sendingCreated
    routeId = (await createMailboxRoute(env, provisioned.zoneId, address)).id

    const domainId = newId('dom')
    await db.insert(domains).values({
      id: domainId,
      userId,
      hostname: provisioned.hostname,
      zoneId: provisioned.zoneId,
      status: 'active',
      routingStatus: provisioned.routingStatus,
      routingEnabled: provisioned.routingEnabled,
      sendingEnabled: provisioned.sendingEnabled,
      sendingSubdomainTag: provisioned.sendingSubdomainTag,
    })
    await db.insert(mailboxes).values({
      id: newId('mbx'),
      userId,
      domainId,
      localPart: parsed.data.username,
      displayName: parsed.data.name,
    })

    return signUp
  } catch (error) {
    if (routeId && zoneId) await deleteMailboxRoute(env, zoneId, routeId).catch(console.warn)
    if (sendingCreated && sendingTag && zoneId) {
      await deleteSendingSubdomain(env, zoneId, sendingTag).catch(console.warn)
    }
    if (userId) await db.delete(users).where(and(eq(users.id, userId), eq(users.role, 'admin')))
    await db.delete(appSettings).where(eq(appSettings.id, 'default'))
    const message = error instanceof Error ? error.message : 'Setup failed'
    return Response.json({ error: 'setup_failed', message }, { status: 502 })
  }
}
