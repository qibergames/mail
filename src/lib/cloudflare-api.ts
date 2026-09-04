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

export async function findMailboxRoute(env: CloudflareEnv, zoneId: string, address: string) {
  const rules = await cfRequest<Array<{ id?: string; tag?: string; matchers?: Array<{ type: string; field?: string; value?: string }> }>>(env, `/zones/${zoneId}/email/routing/rules?per_page=50`)
  const target = address.toLowerCase()
  const rule = rules.find((item) => item.matchers?.some((matcher) => matcher.type === 'literal' && matcher.value?.toLowerCase() === target))
  const id = rule?.id ?? rule?.tag
  return id ? { id } : null
}

export async function createMailboxRoute(env: CloudflareEnv, zoneId: string, address: string) {
  try {
    return await cfRequest<{ id: string }>(env, `/zones/${zoneId}/email/routing/rules`, {
      method: 'POST',
      body: JSON.stringify({
        actions: [{ type: 'worker', value: [env.CF_EMAIL_WORKER_NAME ?? 'qibermail'] }],
        enabled: true,
        matchers: [{ type: 'literal', field: 'to', value: address }],
        name: `Route ${address} to QiberMail`,
      }),
    })
  } catch (error) {
    // Cloudflare rejects a second rule for the same address; reuse the existing one instead of failing.
    if (error instanceof Error && /duplicat/i.test(error.message)) {
      const existing = await findMailboxRoute(env, zoneId, address)
      if (existing) return existing
    }
    throw error
  }
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
  sending: { tag: string; enabled: boolean; status: string | null; dkimSelector: string | null; returnPathDomain: string | null } | null
  sendingRecords: SendingRecord[]
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

  const [routing, dns, rules, catchAll, sendingSetup, host, dmarc, dkim] = await Promise.all([
    attempt('routing', () => cfRequest<{ enabled?: boolean; status?: string; modified?: string }>(env, `/zones/${zoneId}/email/routing`)),
    attempt('dns', () => cfRequest<DnsRecord[] | { record?: DnsRecord[]; errors?: Array<{ code?: string; missing?: DnsRecord }> }>(env, `/zones/${zoneId}/email/routing/dns${isSubdomain ? `?subdomain=${encodeURIComponent(hostname)}` : ''}`)),
    attempt('rules', () => cfRequest<RoutingRule[]>(env, `/zones/${zoneId}/email/routing/rules?per_page=50`)),
    attempt('catch-all', () => cfRequest<RoutingRule>(env, `/zones/${zoneId}/email/routing/rules/catch_all`)),
    attempt('sending', () => getSendingSetup(env, zoneId, hostname)),
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

  const sendingSubdomain = sendingSetup?.subdomain ?? null
  return {
    routing: routing ? { enabled: routing.enabled ?? false, status: routing.status ?? null, modified: routing.modified ?? null } : null,
    requiredRecords,
    missingRecords,
    rules: domainRules.map((rule) => ({ id: rule.id ?? rule.tag ?? '', name: rule.name ?? '', enabled: rule.enabled ?? false, matchers: (rule.matchers ?? []).map(describeMatcher), actions: (rule.actions ?? []).map(describeAction) })),
    catchAll: catchAll ? { enabled: catchAll.enabled ?? false, actions: (catchAll.actions ?? []).map(describeAction) } : null,
    sending: sendingSubdomain ? { tag: sendingSubdomain.tag, enabled: sendingSubdomain.enabled, status: sendingSubdomain.status ?? null, dkimSelector: sendingSubdomain.dkim_selector ?? null, returnPathDomain: sendingSubdomain.return_path_domain ?? null } : null,
    sendingRecords: sendingSetup?.records ?? [],
    checks,
    errors,
  }
}

export async function deleteMailboxRouteByAddress(env: CloudflareEnv, zoneId: string, address: string) {
  const rules = await cfRequest<RoutingRule[]>(env, `/zones/${zoneId}/email/routing/rules?per_page=50`)
  const target = address.toLowerCase()
  const matches = rules.filter((rule) => rule.matchers?.some((matcher) => matcher.type === 'literal' && matcher.value?.toLowerCase() === target))
  for (const rule of matches) {
    const id = rule.id ?? rule.tag
    if (id) await deleteMailboxRoute(env, zoneId, id)
  }
  return matches.length
}

type SendingSubdomain = { tag: string; name: string; enabled: boolean; dkim_selector?: string; return_path_domain?: string; status?: string }
export type SendingRecord = { type: string; name: string; content: string; priority?: number; present: boolean }
export type SendingSetup = { subdomain: SendingSubdomain | null; records: SendingRecord[] }

function normalizeTxt(value: string) {
  return value.trim().replace(/^"|"$/g, '').replace(/"\s*"/g, '').trim().toLowerCase()
}

async function requiredSendingRecords(env: CloudflareEnv, zoneId: string, tag: string) {
  const result = await cfRequest<DnsRecord[] | { record?: DnsRecord[]; records?: DnsRecord[] }>(env, `/zones/${zoneId}/email/sending/subdomains/${tag}/dns`)
  return Array.isArray(result) ? result : result.record ?? result.records ?? []
}

async function markPresence(env: CloudflareEnv, zoneId: string, required: DnsRecord[]): Promise<SendingRecord[]> {
  const names = [...new Set(required.map((record) => record.name.toLowerCase()))]
  const existing = (await Promise.all(names.map((name) => dnsRecords(env, zoneId, name).catch(() => [] as DnsRecord[])))).flat()
  return required.map((record) => ({
    type: record.type,
    name: record.name,
    content: record.content,
    priority: record.priority,
    present: existing.some((item) => item.type === record.type && item.name.toLowerCase() === record.name.toLowerCase() && (record.type === 'TXT' ? normalizeTxt(item.content) === normalizeTxt(record.content) : item.content.toLowerCase().replace(/\.$/, '') === record.content.toLowerCase().replace(/\.$/, ''))),
  }))
}

export async function getSendingSetup(env: CloudflareEnv, zoneId: string, hostname: string): Promise<SendingSetup> {
  const subdomains = await cfRequest<SendingSubdomain[]>(env, `/zones/${zoneId}/email/sending/subdomains`)
  const subdomain = subdomains.find((item) => item.name.toLowerCase() === hostname.toLowerCase()) ?? null
  if (!subdomain) return { subdomain: null, records: [] }
  const required = await requiredSendingRecords(env, zoneId, subdomain.tag).catch(() => [] as DnsRecord[])
  return { subdomain, records: await markPresence(env, zoneId, required) }
}

export async function enableSending(env: CloudflareEnv, zoneId: string, hostname: string): Promise<SendingSetup> {
  const current = await getSendingSetup(env, zoneId, hostname)
  let subdomain = current.subdomain
  if (!subdomain) {
    subdomain = await cfRequest<SendingSubdomain>(env, `/zones/${zoneId}/email/sending/subdomains`, { method: 'POST', body: JSON.stringify({ name: hostname }) })
  }
  if (!subdomain.enabled) {
    subdomain = await cfRequest<SendingSubdomain>(env, `/zones/${zoneId}/email/sending/subdomains/${subdomain.tag}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }) }).catch(() => subdomain as SendingSubdomain)
  }
  const required = await requiredSendingRecords(env, zoneId, subdomain.tag).catch(() => [] as DnsRecord[])
  const records = await markPresence(env, zoneId, required)
  for (const record of records.filter((item) => !item.present)) {
    await cfRequest<unknown>(env, `/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({ type: record.type, name: record.name, content: record.content, ttl: 1, ...(record.priority !== undefined ? { priority: record.priority } : {}) }),
    })
  }
  return getSendingSetup(env, zoneId, hostname)
}
