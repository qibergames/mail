import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { auth } from '@/lib/auth'
import { verifyTurnstile } from '@/lib/turnstile'

async function handlePost(request: Request) {
  const path = new URL(request.url).pathname
  if (path.endsWith('/sign-up/email')) return new Response('Not found', { status: 404 })

  if (path.endsWith('/sign-in/email') || path.endsWith('/request-password-reset')) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'local'
    const rate = await env.LOGIN_RATE_LIMIT.limit({ key: ip })
    if (!rate.success) {
      return Response.json({ code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts' }, {
        status: 429,
        headers: { 'Retry-After': '60' },
      })
    }
    if (!(await verifyTurnstile(request, request.headers.get('x-turnstile-token'))).success) {
      return Response.json({ code: 'VERIFICATION_FAILED', message: 'Verification failed' }, { status: 400 })
    }
  }

  return auth.handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => handlePost(request),
    },
  },
})
