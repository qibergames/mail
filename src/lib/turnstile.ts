type TurnstileResult = { success: boolean; 'error-codes'?: string[] }

export type TurnstileVerification = { success: boolean; errorCodes: string[] }

export async function verifyTurnstile(request: Request, token: unknown): Promise<TurnstileVerification> {
  const { env } = await import('cloudflare:workers')
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) return { success: true, errorCodes: [] }
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
    return { success: false, errorCodes: ['missing-input-response'] }
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: request.headers.get('cf-connecting-ip') ?? undefined,
      }),
    })
    const result = await response.json<TurnstileResult>()
    const verification = {
      success: response.ok && result.success,
      errorCodes: result['error-codes'] ?? (response.ok ? [] : [`http-${response.status}`]),
    }
    if (!verification.success) console.warn('Turnstile verification failed', verification)
    return verification
  } catch (error) {
    console.error('Turnstile Siteverify unavailable', error)
    return { success: false, errorCodes: ['internal-error'] }
  }
}
