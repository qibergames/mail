type CloudflareResponse<T> = {
  success: boolean
  result: T
  errors?: Array<{ code?: number; message: string }>
}

export type CloudflareDomain = {
  id: string
  hostname: string
  zoneId: string
  routingEnabled: boolean
  routingStatus: string | null
  sendingEnabled: boolean
  sendingSubdomainTag: string | null
  sendingCreated: boolean
}

function authHeaders(env: CloudflareEnv): HeadersInit {
  if (env.CF_API_KEY && env.CF_EMAIL) {
    return { 'X-Auth-Key': env.CF_API_KEY, 'X-Auth-Email': env.CF_EMAIL }
  }
  if (env.CF_TOKEN) return { Authorization: `Bearer ${env.CF_TOKEN}` }
  throw new Error('CF_TOKEN is not configured')
}

async function cfRequest<T>(env: CloudflareEnv, path: string, init?: RequestInit) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { ...authHeaders(env), 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json<CloudflareResponse<T>>()
  if (!response.ok || !body.success) {
    throw new Error(body.errors?.map((error) => error.message).join('; ') || 'Cloudflare API request failed')
  }
  return body.result
}

function zoneCandidates(hostname: string) {
  const labels = hostname.toLowerCase().split('.').filter(Boolean)
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join('.'))
}

export async function provisionDomain(env: CloudflareEnv, rawHostname: string): Promise<CloudflareDomain> {
  const hostname = rawHostname.toLowerCase().trim()
  let zone: { id: string; name: string } | undefined

  for (const candidate of zoneCandidates(hostname)) {
    const zones = await cfRequest<Array<{ id: string; name: string }>>(
      env,
      `/zones?name=${encodeURIComponent(candidate)}&status=active`,
    )
    zone = zones.find((item) => item.name === candidate)
    if (zone) break
  }
  if (!zone) throw new Error('Cloudflare zone not found')

  const routing = await cfRequest<{ status?: string; enabled?: boolean }>(
    env,
    `/zones/${zone.id}/email/routing/dns`,
    {
      method: 'POST',
      ...(hostname === zone.name ? {} : { body: JSON.stringify({ name: hostname }) }),
    },
  )
  await cfRequest<unknown>(env, `/zones/${zone.id}/email/routing/rules/catch_all`, {
    method: 'PUT',
    body: JSON.stringify({
      actions: [{ type: 'worker', value: [env.CF_EMAIL_WORKER_NAME ?? 'qibermail'] }],
      enabled: true,
      matchers: [{ type: 'all' }],
      name: `Route all email to ${env.CF_EMAIL_WORKER_NAME ?? 'qibermail'}`,
    }),
  })

  let sendingSubdomainTag: string | null = null
  let sendingEnabled = false
  let sendingCreated = false
  if (hostname !== zone.name) {
    const existing = await cfRequest<Array<{ tag: string; name: string; enabled: boolean }>>(
      env,
      `/zones/${zone.id}/email/sending/subdomains`,
    )
    const found = existing.find((item) => item.name === hostname)
    const sending = found ?? await cfRequest<{ tag: string; enabled: boolean }>(
        env,
        `/zones/${zone.id}/email/sending/subdomains`,
        { method: 'POST', body: JSON.stringify({ name: hostname }) },
      )
    sendingSubdomainTag = sending.tag
    sendingEnabled = sending.enabled
    sendingCreated = !found
  }

  return {
    id: new URL(`https://${hostname}`).hostname,
    hostname,
    zoneId: zone.id,
    routingEnabled: routing.enabled ?? true,
    routingStatus: routing.status ?? null,
    sendingEnabled,
    sendingSubdomainTag,
    sendingCreated,
  }
}

export async function createMailboxRoute(env: CloudflareEnv, zoneId: string, address: string) {
  return cfRequest<{ id: string }>(env, `/zones/${zoneId}/email/routing/rules`, {
    method: 'POST',
    body: JSON.stringify({
      actions: [{ type: 'worker', value: [env.CF_EMAIL_WORKER_NAME ?? 'qibermail'] }],
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: address }],
      name: `Route ${address} to QiberMail`,
    }),
  })
}

export async function deleteMailboxRoute(env: CloudflareEnv, zoneId: string, ruleId: string) {
  return cfRequest<unknown>(env, `/zones/${zoneId}/email/routing/rules/${ruleId}`, { method: 'DELETE' })
}

export async function deleteSendingSubdomain(env: CloudflareEnv, zoneId: string, tag: string) {
  return cfRequest<unknown>(env, `/zones/${zoneId}/email/sending/subdomains/${tag}`, { method: 'DELETE' })
}
