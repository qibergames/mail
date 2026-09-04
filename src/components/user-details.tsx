import { Trans, useLingui } from '@lingui/react'
import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, AtSign, LoaderCircle, Mail, Plus, ScrollText, Star, Trash2, UserRoundCog, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { Status } from './section-ui'
import { Badge, CheckboxField, EmptyState, Field, Loading, SelectField, StatusBanner } from './section-ui'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

type UserDetailsData = {
  user: { id: string; name: string; email: string; resetEmail: string | null; forwardingEmail: string | null; role: 'admin' | 'user'; banned: boolean; canManageMailboxes: boolean; createdAt: string }
  mailboxes: Array<{ id: string; domainId: string; localPart: string; hostname: string; displayName: string | null; type: 'personal' | 'shared'; disabled: boolean; createdAt: string }>
  aliases: Array<{ id: string; mailboxId: string; localPart: string; hostname: string }>
  access: Array<{ id: string; mailboxId: string; permission: string; localPart: string; hostname: string }>
  domains: Array<{ id: string; hostname: string }>
  logs: Array<{ id: string; action: string; metadata: string | null; createdAt: string }>
}

export function UserDetails({ userId }: { userId: string }) {
  const { i18n } = useLingui()
  const [data, setData] = useState<UserDetailsData | null>(null)
  const [missing, setMissing] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState(false)
  const [aliasFor, setAliasFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/users/${userId}`)
    if (response.ok) setData(await response.json<UserDetailsData>())
    else setMissing(true)
  }, [userId])
  useEffect(() => { void load() }, [load])

  async function post(body: unknown, form?: HTMLFormElement) {
    setBusy(true)
    setStatus(null)
    const response = await fetch(`/api/admin/users/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json<UserDetailsData & { error?: string }>().catch(() => null)
    if (response.ok && result) { setData(result); setStatus({ tone: 'success', text: i18n._('Saved') }); form?.reset(); setAliasFor(null) }
    else setStatus({ tone: 'error', text: result?.error || i18n._('Save failed') })
    setBusy(false)
  }

  async function account(body: unknown) {
    setBusy(true)
    setStatus(null)
    const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json<{ error?: string }>().catch(() => null)
    setStatus(response.ok ? { tone: 'success', text: i18n._('Saved') } : { tone: 'error', text: result?.error || i18n._('Save failed') })
    setBusy(false)
    if (response.ok) await load()
  }

  if (missing) return <EmptyState icon={Users}><Trans id="Account not found." /><Button asChild variant="outline" size="sm"><Link to="/admin/$section" params={{ section: 'accounts' }}><ArrowLeft /><Trans id="Back to accounts" /></Link></Button></EmptyState>
  if (!data) return <Loading />

  const { user } = data
  const format = (value: string | null | undefined) => value ? new Date(value).toLocaleString(i18n.locale) : '—'
  const address = (item: { localPart: string; hostname: string }) => `${item.localPart}@${item.hostname}`
  const primary = data.mailboxes.find((mailbox) => address(mailbox) === user.email)

  return <>
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
      <Button asChild variant="outline" size="icon" className="shrink-0 rounded-xl"><Link to="/admin/$section" params={{ section: 'accounts' }} aria-label={i18n._('Back to accounts')} title={i18n._('Back to accounts')}><ArrowLeft /></Link></Button>
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/15 ring-inset"><Users className="size-6" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{user.name}</h2>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{user.email} · <Trans id="Added" /> {format(user.createdAt)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge active={user.role === 'admin'}>{user.role}</Badge>
        {user.banned && <Badge danger><Trans id="Disabled" /></Badge>}
        {user.canManageMailboxes && <Badge><Trans id="Mailbox manager" /></Badge>}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void account({ action: 'user:role', userId: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}>{user.role === 'admin' ? <Trans id="Make user" /> : <Trans id="Make admin" />}</Button>
        <Button variant="outline" disabled={busy} onClick={() => void account({ action: 'user:ban', userId: user.id, banned: !user.banned })}>{user.banned ? <Trans id="Enable account" /> : <Trans id="Disable account" />}</Button>
      </div>
    </div>
    <StatusBanner status={status} />

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel icon={UserRoundCog} title="Profile">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'profile', name: form.get('name'), email: form.get('email'), resetEmail: form.get('resetEmail'), forwardingEmail: form.get('forwardingEmail'), canManageMailboxes: form.get('canManageMailboxes') === 'on' }) }}>
          <Field label="Name" name="name" defaultValue={user.name} required />
          <Field label="Sign-in email" name="email" type="email" defaultValue={user.email} required />
          <Field label="Recovery email" name="resetEmail" type="email" defaultValue={user.resetEmail ?? ''} />
          <Field label="Forward all mail to" name="forwardingEmail" type="email" defaultValue={user.forwardingEmail ?? ''} />
          <CheckboxField label="Can manage mailboxes" name="canManageMailboxes" defaultChecked={user.canManageMailboxes} className="sm:col-span-2" />
          <p className="text-xs text-muted-foreground sm:col-span-2"><Trans id="The sign-in email is the account's primary address. Pick a mailbox below to make it primary." /></p>
          <div className="flex justify-end sm:col-span-2"><Button disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : null}<Trans id="Save" /></Button></div>
        </form>
      </Panel>

      <Panel icon={UserRoundCog} title="Shared access" count={data.access.length}>
        {data.access.length
          ? <ul className="grid gap-2">{data.access.map((item) => <li key={item.id} className="flex items-center gap-2 rounded-xl border p-3 text-sm"><span className="min-w-0 flex-1 truncate font-medium">{address(item)}</span><Badge>{item.permission}</Badge></li>)}</ul>
          : <p className="text-sm text-muted-foreground"><Trans id="No delegated mailboxes." /></p>}
        <h4 className="mt-5 mb-2 flex items-center gap-2 text-sm font-semibold"><ScrollText className="size-4 text-muted-foreground" /><Trans id="Recent activity" /></h4>
        {data.logs.length
          ? <ul className="grid gap-1 text-xs text-muted-foreground">{data.logs.slice(0, 8).map((log) => <li key={log.id} className="flex gap-2"><span className="shrink-0 tabular-nums">{format(log.createdAt)}</span><span className="truncate font-mono">{log.action}</span></li>)}</ul>
          : <p className="text-sm text-muted-foreground"><Trans id="No records yet." /></p>}
      </Panel>
    </div>

    <Panel icon={Mail} title="Mailboxes" count={data.mailboxes.length}>
      {data.mailboxes.length === 0 && <p className="text-sm text-muted-foreground"><Trans id="No records yet." /></p>}
      <div className="grid gap-3">
        {data.mailboxes.map((mailbox) => {
          const isPrimary = primary?.id === mailbox.id
          const aliases = data.aliases.filter((alias) => alias.mailboxId === mailbox.id)
          return <article key={mailbox.id} className={cn('rounded-2xl border p-4', isPrimary && 'border-primary/40 bg-primary/5')}>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || isPrimary} title={i18n._(isPrimary ? 'Primary address' : 'Make primary')} aria-label={i18n._(isPrimary ? 'Primary address' : 'Make primary')} onClick={() => void post({ action: 'primary', mailboxId: mailbox.id })} className={cn('grid size-9 place-items-center rounded-xl transition-colors', isPrimary ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground')}><Star className={cn('size-4', isPrimary && 'fill-current')} /></button>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{address(mailbox)}</p>
                <p className="truncate text-xs text-muted-foreground">{isPrimary ? i18n._('Primary address') : i18n._('Secondary mailbox')} · <Trans id="Added" /> {format(mailbox.createdAt)}</p>
              </div>
              <Badge>{mailbox.type}</Badge>
              {mailbox.disabled && <Badge danger><Trans id="Disabled" /></Badge>}
            </div>
            <form className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'mailbox:update', mailboxId: mailbox.id, displayName: form.get('displayName'), type: form.get('type'), disabled: form.get('disabled') === 'on' }) }}>
              <Field label="Display name" name="displayName" defaultValue={mailbox.displayName ?? ''} />
              <SelectField label="Mailbox type" name="type" defaultValue={mailbox.type} options={[['personal', i18n._('Personal')], ['shared', i18n._('Shared')]]} />
              <CheckboxField label="Disabled" name="disabled" defaultChecked={mailbox.disabled} className="h-10" />
              <Button variant="outline" disabled={busy}><Trans id="Save mailbox" /></Button>
            </form>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><AtSign className="size-3.5" /><Trans id="Aliases" /></span>
              {aliases.map((alias) => <span key={alias.id} className="flex items-center gap-1 rounded-full border bg-muted py-0.5 pr-1 pl-2.5 text-xs font-medium">{address(alias)}<Button type="button" variant="ghost" size="icon-sm" className="size-5 rounded-full" disabled={busy} onClick={() => void post({ action: 'alias:delete', aliasId: alias.id })} aria-label={i18n._('Remove')} title={i18n._('Remove')}><Trash2 className="size-3" /></Button></span>)}
              {aliasFor === mailbox.id
                ? <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'alias:create', mailboxId: mailbox.id, domainId: form.get('domainId'), localPart: form.get('localPart') }, event.currentTarget) }}>
                  <input name="localPart" required autoFocus placeholder={i18n._('Alias address')} aria-label={i18n._('Alias address')} className="h-8 w-36 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  <span className="text-xs text-muted-foreground">@</span>
                  <select name="domainId" defaultValue={mailbox.domainId} aria-label={i18n._('Domain')} className="h-8 rounded-md border bg-background px-2 text-xs outline-none">{data.domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.hostname}</option>)}</select>
                  <Button size="sm" disabled={busy}><Plus /><Trans id="Add" /></Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAliasFor(null)}><Trans id="Cancel" /></Button>
                </form>
                : <Button type="button" size="sm" variant="ghost" className="h-6 rounded-full px-2 text-xs" disabled={busy} onClick={() => setAliasFor(mailbox.id)}><Plus className="size-3" /><Trans id="Add alias" /></Button>}
            </div>
          </article>
        })}
      </div>
    </Panel>
  </>
}

function Panel({ icon: Icon, title, count, children }: { icon: LucideIcon; title: string; count?: number; children: React.ReactNode }) {
  return <section className="rounded-2xl border bg-card p-5 shadow-sm">
    <h3 className="mb-4 flex items-center gap-2 font-semibold"><Icon className="size-4 text-muted-foreground" /><Trans id={title} />{count !== undefined && <span className="ml-auto rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums">{count}</span>}</h3>
    {children}
  </section>
}
