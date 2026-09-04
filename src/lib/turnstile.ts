import { newId } from './ids'

type TurnstileResult = { success: boolean }

export async function verifyTurnstile(request: Request, token: unknown) {
  const { env } = await import('cloudflare:workers')
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) return true
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) return false

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: request.headers.get('cf-connecting-ip') ?? undefined,
        idempotency_key: newId('ts'),
      }),
    })
    return response.ok && (await response.json<TurnstileResult>()).success
  } catch {
    return false
  }
}
