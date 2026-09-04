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

type DnsRecord = { type: string; name: string; content: string; priority?: number; ttl?: number }
type RoutingRule = { id?: string; tag?: string; name?: string; enabled?: boolean; matchers?: Array<{ type: string; field?: string; value?: string }>; actions?: Array<{ type: string; value?: string[] }> }

export type DomainDnsCheck = { kind: 'mx' | 'spf' | 'dkim' | 'dmarc'; name: string; ok: boolean; records: string[] }

export type DomainInspection = {
  routing: { enabled: boolean; status: string | null; modified: string | null } | null
  requiredRecords: DnsRecord[]
  missingRecords: DnsRecord[]
  rules: Array<{ id: string; name: string; enabled: boolean; matchers: string[]; actions: string[] }>
  catchAll: { enabled: boolean; actions: string[] } | null
  sending: { tag: string; enabled: boolean; status: string | null } | null
  checks: DomainDnsCheck[]
  errors: string[]
}

function describeMatcher(matcher: { type: string; field?: string; value?: string }) {
  return matcher.type === 'all' ? 'all' : `${matcher.field ?? matcher.type} = ${matcher.value ?? ''}`
}

function describeAction(action: { type: string; value?: string[] }) {
  return action.value?.length ? `${action.type}: ${action.value.join(', ')}` : action.type
}

async function dnsRecords(env: CloudflareEnv, zoneId: string, name: string) {
  return cfRequest<DnsRecord[]>(env, `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=100`)
}

export async function inspectDomain(env: CloudflareEnv, zoneId: string, hostname: string): Promise<DomainInspection> {
  const errors: string[] = []
  const attempt = async <T,>(label: string, run: () => Promise<T>): Promise<T | null> => {
    try { return await run() } catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); return null }
  }
  const zone = await attempt('zone', () => cfRequest<{ name: string }>(env, `/zones/${zoneId}`))
  const isSubdomain = Boolean(zone && zone.name !== hostname)

  const [routing, dns, rules, catchAll, subdomains, host, dmarc, dkim] = await Promise.all([
    attempt('routing', () => cfRequest<{ enabled?: boolean; status?: string; modified?: string }>(env, `/zones/${zoneId}/email/routing`)),
    attempt('dns', () => cfRequest<DnsRecord[] | { record?: DnsRecord[]; errors?: Array<{ code?: string; missing?: DnsRecord }> }>(env, `/zones/${zoneId}/email/routing/dns${isSubdomain ? `?subdomain=${encodeURIComponent(hostname)}` : ''}`)),
    attempt('rules', () => cfRequest<RoutingRule[]>(env, `/zones/${zoneId}/email/routing/rules?per_page=50`)),
    attempt('catch-all', () => cfRequest<RoutingRule>(env, `/zones/${zoneId}/email/routing/rules/catch_all`)),
    isSubdomain ? attempt('sending', () => cfRequest<Array<{ tag: string; name: string; enabled: boolean; status?: string }>>(env, `/zones/${zoneId}/email/sending/subdomains`)) : Promise.resolve(null),
    attempt('dns records', () => dnsRecords(env, zoneId, hostname)),
    attempt('dmarc record', () => dnsRecords(env, zoneId, `_dmarc.${hostname}`)),
    attempt('dkim record', () => dnsRecords(env, zoneId, `cf2024-1._domainkey.${hostname}`)),
  ])

  const requiredRecords = Array.isArray(dns) ? dns : dns?.record ?? []
  const missingRecords = Array.isArray(dns) ? [] : (dns?.errors ?? []).flatMap((item) => item.missing ? [item.missing] : [])
  const suffix = `@${hostname}`
  const domainRules = (rules ?? []).filter((rule) => rule.matchers?.some((matcher) => matcher.type === 'all' || matcher.value?.toLowerCase().endsWith(suffix)))

  const mx = (host ?? []).filter((record) => record.type === 'MX').map((record) => `${record.priority ?? ''} ${record.content}`.trim())
  const spf = (host ?? []).filter((record) => record.type === 'TXT' && /v=spf1/i.test(record.content)).map((record) => record.content)
  const dkimRecords = (dkim ?? []).filter((record) => record.type === 'TXT' || record.type === 'CNAME').map((record) => record.content)
  const dmarcRecords = (dmarc ?? []).filter((record) => record.type === 'TXT').map((record) => record.content)
  const checks: DomainDnsCheck[] = [
    { kind: 'mx', name: hostname, ok: mx.some((value) => /mx\.cloudflare\.net/i.test(value)), records: mx },
    { kind: 'spf', name: hostname, ok: spf.some((value) => /_spf\.mx\.cloudflare\.net/i.test(value)), records: spf },
    { kind: 'dkim', name: `cf2024-1._domainkey.${hostname}`, ok: dkimRecords.some((value) => /v=DKIM1|dkim/i.test(value)), records: dkimRecords },
    { kind: 'dmarc', name: `_dmarc.${hostname}`, ok: dmarcRecords.some((value) => /v=DMARC1/i.test(value)), records: dmarcRecords },
  ]

  const sendingSubdomain = subdomains?.find((item) => item.name === hostname)
  return {
    routing: routing ? { enabled: routing.enabled ?? false, status: routing.status ?? null, modified: routing.modified ?? null } : null,
    requiredRecords,
    missingRecords,
    rules: domainRules.map((rule) => ({ id: rule.id ?? rule.tag ?? '', name: rule.name ?? '', enabled: rule.enabled ?? false, matchers: (rule.matchers ?? []).map(describeMatcher), actions: (rule.actions ?? []).map(describeAction) })),
    catchAll: catchAll ? { enabled: catchAll.enabled ?? false, actions: (catchAll.actions ?? []).map(describeAction) } : null,
    sending: sendingSubdomain ? { tag: sendingSubdomain.tag, enabled: sendingSubdomain.enabled, status: sendingSubdomain.status ?? null } : null,
    checks,
    errors,
  }
}
