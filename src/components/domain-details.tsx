import { Trans, useLingui } from '@lingui/react'
import { Link, useNavigate } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { AlertCircle, ArrowLeft, AtSign, CheckCircle2, CircleDashed, Globe2, Inbox, LoaderCircle, Mail, RefreshCw, Route as RouteIcon, Send, ShieldCheck, Trash2, TriangleAlert, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Status } from './section-ui'
import { Badge, EmptyState, Loading, StatusBanner } from './section-ui'
import { Button } from './ui/button'
import type { DomainInspection } from '@/lib/cloudflare-api'
import { cn } from '@/lib/utils'

type DomainDetailsData = {
  domain: { id: string; hostname: string; zoneId: string; status: 'pending' | 'active' | 'error'; routingStatus: string | null; routingEnabled: boolean; sendingEnabled: boolean; sendingSubdomainTag: string | null; createdAt: string }
  mailboxes: Array<{ id: string; localPart: string; displayName: string | null; type: 'personal' | 'shared'; disabled: boolean; owner: string }>
  aliases: Array<{ id: string; localPart: string; mailboxId: string }>
  rules: Array<{ id: string; name: string | null; pattern: string; action: string; forwardTo: string | null; enabled: boolean; matchCount: number }>
  stats: { inbound: number; outbound: number; failedJobs: number; lastInboundAt: string | null; lastOutboundAt: string | null }
  cloudflare: DomainInspection | null
  cloudflareError: string | null
}

const checkLabels: Record<DomainInspection['checks'][number]['kind'], string> = { mx: 'MX (inbound mail)', spf: 'SPF (sender policy)', dkim: 'DKIM (signing key)', dmarc: 'DMARC (policy)' }

export function DomainDetails({ domainId }: { domainId: string }) {
  const { i18n } = useLingui()
  const navigate = useNavigate()
  const [data, setData] = useState<DomainDetailsData | null>(null)
  const [missing, setMissing] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/domains/${domainId}`)
    if (response.ok) setData(await response.json<DomainDetailsData>())
    else setMissing(true)
  }, [domainId])
  useEffect(() => { void load() }, [load])

  async function sync(action: 'sync' | 'sending:enable' | 'routing:repair' = 'sync') {
    setBusy(true)
    setStatus(null)
    const response = await fetch(`/api/admin/domains/${domainId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    const result = await response.json<DomainDetailsData & { error?: string }>().catch(() => null)
    if (response.ok && result) { setData(result); setStatus({ tone: 'success', text: i18n._(action === 'sync' ? 'Synced from Cloudflare' : action === 'routing:repair' ? 'Routing rules repaired' : 'Email sending configured') }) }
    else setStatus({ tone: 'error', text: result?.error || i18n._('Sync failed') })
    setBusy(false)
  }

  async function remove() {
    if (!confirm(i18n._('Delete this domain? Routing rules on it are removed. Mailboxes and aliases must be deleted first.'))) return
    setBusy(true)
    setStatus(null)
    const response = await fetch(`/api/admin/domains/${domainId}`, { method: 'DELETE' })
    const result = await response.json<{ error?: string }>().catch(() => null)
    setBusy(false)
    if (response.ok) { void navigate({ to: '/admin/$section', params: { section: 'domains' } }); return }
    setStatus({ tone: 'error', text: result?.error || i18n._('Save failed') })
  }

  if (missing) return <EmptyState icon={Globe2}><Trans id="Domain not found." /><Button asChild variant="outline" size="sm"><Link to="/admin/$section" params={{ section: 'domains' }}><ArrowLeft /><Trans id="Back to domains" /></Link></Button></EmptyState>
  if (!data) return <Loading />

  const { domain, cloudflare, stats } = data
  const format = (value: string | null | undefined) => value ? new Date(value).toLocaleString(i18n.locale) : '—'
  const healthy = cloudflare ? cloudflare.checks.filter((check) => check.ok).length : 0
  const misrouted = cloudflare?.rules.filter((rule) => !rule.ok) ?? []
  const sendingMissing = cloudflare?.sendingRecords.filter((record) => !record.present) ?? []
  const sendingReady = Boolean(cloudflare?.sending?.enabled) && sendingMissing.length === 0 && (cloudflare?.sendingRecords.length ?? 0) > 0

  return <>
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
      <Button asChild variant="outline" size="icon" className="shrink-0 rounded-xl"><Link to="/admin/$section" params={{ section: 'domains' }} aria-label={i18n._('Back to domains')} title={i18n._('Back to domains')}><ArrowLeft /></Link></Button>
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/15 ring-inset"><Globe2 className="size-6" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{domain.hostname}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground"><Trans id="Added" /> {format(domain.createdAt)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge active={domain.status === 'active'} danger={domain.status === 'error'}>{i18n._(domain.status)}</Badge>
        <Badge active={domain.routingEnabled}>routing</Badge>
        <Badge active={domain.sendingEnabled}>sending</Badge>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void sync()}>{busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}<Trans id="Sync from Cloudflare" /></Button>
        <Button variant="outline" size="icon" className="text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400" disabled={busy} onClick={() => void remove()} aria-label={i18n._('Delete domain')} title={i18n._('Delete domain')}><Trash2 /></Button>
      </div>
    </div>
    <StatusBanner status={status} />
    {data.cloudflareError && <StatusBanner status={{ tone: 'error', text: `${i18n._('Cloudflare check failed')}: ${data.cloudflareError}` }} />}

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={Mail} label="Mailboxes" value={data.mailboxes.length} hint={`${data.aliases.length} ${i18n._('aliases')}`} />
      <Stat icon={Inbox} label="Received" value={stats.inbound} hint={`${i18n._('Last')}: ${format(stats.lastInboundAt)}`} />
      <Stat icon={Send} label="Sent" value={stats.outbound} hint={`${i18n._('Last')}: ${format(stats.lastOutboundAt)}`} tone={stats.failedJobs ? 'danger' : undefined} extra={stats.failedJobs ? `${stats.failedJobs} ${i18n._('failed')}` : undefined} />
      <Stat icon={ShieldCheck} label="DNS health" value={cloudflare ? `${healthy}/${cloudflare.checks.length}` : '—'} hint={i18n._('MX, SPF, DKIM, DMARC')} tone={cloudflare && healthy < cloudflare.checks.length ? 'warn' : undefined} />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel icon={RouteIcon} title="Email Routing">
        {cloudflare?.routing
          ? <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <Term label="Status" /><dd><Badge active={cloudflare.routing.status === 'ready'} danger={cloudflare.routing.status?.includes('misconfigured')}>{cloudflare.routing.status ?? '—'}</Badge></dd>
            <Term label="Enabled" /><dd>{cloudflare.routing.enabled ? i18n._('Yes') : i18n._('No')}</dd>
            <Term label="Catch-all" /><dd className="break-all">{cloudflare.catchAll ? `${cloudflare.catchAll.enabled ? i18n._('Enabled') : i18n._('Disabled')} · ${cloudflare.catchAll.actions.join(', ') || '—'}` : '—'}</dd>
            <Term label="Cloudflare rules" /><dd>{cloudflare.rules.length}</dd>
            <Term label="Last modified" /><dd>{format(cloudflare.routing.modified)}</dd>
            <Term label="Zone" /><dd className="font-mono text-xs break-all">{domain.zoneId}</dd>
          </dl>
          : <Unavailable />}
        {misrouted.length > 0 && <div className="mt-4 flex flex-col gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-medium text-red-700 dark:text-red-400"><TriangleAlert className="size-4 shrink-0" /><Trans id="Some addresses are routed to another worker, so their mail never reaches QiberMail." /></p>
            {misrouted.map((rule) => <p key={rule.id} className="mt-1 pl-6 font-mono text-xs break-all text-muted-foreground">{rule.matchers.join(', ')} → {rule.actions.join(', ') || '—'}</p>)}
          </div>
          <Button className="shrink-0" disabled={busy} onClick={() => void sync('routing:repair')}>{busy ? <LoaderCircle className="animate-spin" /> : <Wrench />}<Trans id="Repair routing" /></Button>
        </div>}
        {cloudflare?.missingRecords.length ? <div className="mt-4 space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400"><TriangleAlert className="size-4" /><Trans id="Missing DNS records" /></p>
          {cloudflare.missingRecords.map((record, index) => <p key={index} className="font-mono text-xs break-all">{record.type} {record.name} → {record.priority !== undefined ? `${record.priority} ` : ''}{record.content}</p>)}
        </div> : null}
      </Panel>

      <Panel icon={Send} title="Email Sending">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <Term label="Enabled" /><dd>{(cloudflare?.sending?.enabled ?? domain.sendingEnabled) ? i18n._('Yes') : i18n._('No')}</dd>
          <Term label="Status" /><dd>{cloudflare ? (cloudflare.sending ? (sendingReady ? <Badge active>{i18n._('ready')}</Badge> : <Badge danger={!cloudflare.sending.enabled}>{cloudflare.sending.enabled ? i18n._('DNS incomplete') : i18n._('disabled')}</Badge>) : <Badge danger>{i18n._('not configured')}</Badge>) : '—'}</dd>
          <Term label="DKIM selector" /><dd className="font-mono text-xs break-all">{cloudflare?.sending?.dkimSelector ?? '—'}</dd>
          <Term label="Return path" /><dd className="font-mono text-xs break-all">{cloudflare?.sending?.returnPathDomain ?? '—'}</dd>
          <Term label="Subdomain tag" /><dd className="font-mono text-xs break-all">{cloudflare?.sending?.tag ?? domain.sendingSubdomainTag ?? '—'}</dd>
        </dl>
        {cloudflare && !sendingReady && <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center">
          <p className="flex flex-1 items-start gap-2 text-amber-700 dark:text-amber-400"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{cloudflare.sending ? (cloudflare.sending.enabled ? i18n._('Some sending DNS records are missing, so outgoing mail may be rejected.') : i18n._('Email Sending is registered but disabled for this domain.')) : i18n._('Email Sending is not set up for this domain, so mail cannot be sent from it.')}</p>
          <Button className="shrink-0" disabled={busy} onClick={() => void sync('sending:enable')}>{busy ? <LoaderCircle className="animate-spin" /> : <Wrench />}{cloudflare.sending?.enabled ? <Trans id="Repair sending DNS" /> : <Trans id="Enable sending" />}</Button>
        </div>}
        {cloudflare?.sendingRecords.length ? <ul className="mt-4 grid gap-2">
          {cloudflare.sendingRecords.map((record, index) => <li key={index} className="rounded-xl border p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">{record.present ? <CheckCircle2 className="size-4 text-emerald-500" /> : <AlertCircle className="size-4 text-amber-500" />}{record.type}<span className="ml-auto truncate font-mono text-xs font-normal text-muted-foreground">{record.name}</span></p>
            <p className="mt-1 pl-6 font-mono text-xs break-all text-muted-foreground">{record.priority !== undefined ? `${record.priority} ` : ''}{record.content}</p>
          </li>)}
        </ul> : null}
        <h4 className="mt-5 mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase"><Trans id="Email Routing records" /></h4>
        <ul className="grid gap-2">
          {cloudflare
            ? cloudflare.checks.map((check) => <li key={check.kind} className="rounded-xl border p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">{check.ok ? <CheckCircle2 className="size-4 text-emerald-500" /> : <AlertCircle className="size-4 text-amber-500" />}<Trans id={checkLabels[check.kind]} /><span className="ml-auto font-mono text-xs font-normal text-muted-foreground">{check.name}</span></p>
              {check.records.length
                ? check.records.map((record, index) => <p key={index} className="mt-1 pl-6 font-mono text-xs break-all text-muted-foreground">{record}</p>)
                : <p className="mt-1 pl-6 text-xs text-muted-foreground"><Trans id="No record found" /></p>}
            </li>)
            : <li><Unavailable /></li>}
        </ul>
      </Panel>
    </div>

    {cloudflare?.errors.length ? <StatusBanner status={{ tone: 'error', text: cloudflare.errors.join(' · ') }} /> : null}

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel icon={Mail} title="Mailboxes" count={data.mailboxes.length}>
        {data.mailboxes.length
          ? <ul className="grid gap-2">{data.mailboxes.map((mailbox) => <Row key={mailbox.id} title={`${mailbox.localPart}@${domain.hostname}`} description={mailbox.displayName || mailbox.owner} badges={<><Badge>{mailbox.type}</Badge>{mailbox.disabled && <Badge danger><Trans id="Disabled" /></Badge>}</>} />)}</ul>
          : <p className="text-sm text-muted-foreground"><Trans id="No records yet." /></p>}
      </Panel>
      <Panel icon={AtSign} title="Aliases" count={data.aliases.length}>
        {data.aliases.length
          ? <ul className="grid gap-2">{data.aliases.map((alias) => { const target = data.mailboxes.find((mailbox) => mailbox.id === alias.mailboxId); return <Row key={alias.id} title={`${alias.localPart}@${domain.hostname}`} description={target ? `→ ${target.localPart}@${domain.hostname}` : alias.mailboxId} /> })}</ul>
          : <p className="text-sm text-muted-foreground"><Trans id="No records yet." /></p>}
      </Panel>
    </div>

    <Panel icon={RouteIcon} title="Domain routing" count={data.rules.length}>
      {data.rules.length
        ? <ul className="grid gap-2 md:grid-cols-2">{data.rules.map((rule) => <Row key={rule.id} title={rule.name || rule.pattern} description={`${rule.pattern} → ${rule.action}${rule.forwardTo ? ` (${rule.forwardTo})` : ''}`} badges={<><Badge>{rule.matchCount} {i18n._('matches')}</Badge>{!rule.enabled && <Badge danger><Trans id="Disabled" /></Badge>}</>} />)}</ul>
        : <p className="text-sm text-muted-foreground"><Trans id="No records yet." /></p>}
    </Panel>
  </>
}

function Stat({ icon: Icon, label, value, hint, extra, tone }: { icon: LucideIcon; label: string; value: number | string; hint?: string; extra?: string; tone?: 'danger' | 'warn' }) {
  return <div className="flex gap-3 rounded-2xl border bg-card p-4 shadow-xs">
    <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground', tone === 'danger' && 'bg-red-500/10 text-red-600 dark:text-red-400', tone === 'warn' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400')}><Icon className="size-5" /></span>
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase"><Trans id={label} /></p>
      <p className="text-2xl font-semibold tabular-nums">{value}{extra && <span className="ml-2 text-sm font-medium text-red-600 dark:text-red-400">{extra}</span>}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  </div>
}

function Panel({ icon: Icon, title, count, children }: { icon: LucideIcon; title: string; count?: number; children: React.ReactNode }) {
  return <section className="rounded-2xl border bg-card p-5 shadow-sm">
    <h3 className="mb-4 flex items-center gap-2 font-semibold"><Icon className="size-4 text-muted-foreground" /><Trans id={title} />{count !== undefined && <span className="ml-auto rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums">{count}</span>}</h3>
    {children}
  </section>
}

function Term({ label }: { label: string }) {
  return <dt className="text-muted-foreground"><Trans id={label} /></dt>
}

function Unavailable() {
  return <p className="flex items-center gap-2 text-sm text-muted-foreground"><CircleDashed className="size-4" /><Trans id="Cloudflare data unavailable" /></p>
}

function Row({ title, description, badges }: { title: string; description?: string; badges?: React.ReactNode }) {
  return <li className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
    <div className="min-w-0 flex-1"><p className="truncate font-medium">{title}</p>{description && <p className="truncate text-xs text-muted-foreground">{description}</p>}</div>
    {badges}
  </li>
}
