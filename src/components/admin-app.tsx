import { Trans, useLingui } from '@lingui/react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, LoaderCircle, Plus, Shield, UserRoundCheck, UserRoundX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

type AdminData = {
  users: Array<{ id: string; name: string; email: string; role: 'admin' | 'user'; banned: boolean }>
  domains: Array<{ id: string; hostname: string; status: string; routingEnabled: boolean; sendingEnabled: boolean }>
  mailboxes: Array<{ id: string; userId: string; domainId: string; localPart: string; hostname: string; displayName: string | null; type: 'personal' | 'shared'; disabled: boolean }>
  aliases: Array<{ id: string; mailboxId: string; domainId: string; localPart: string }>
  access: Array<{ id: string; mailboxId: string; userId: string; permission: string }>
  rules: Array<{ id: string; domainId: string; mailboxId: string | null; name: string | null; action: string; pattern: string; matchCount: number }>
  logs: Array<{ id: string; actorUserId: string | null; action: string; metadata: string | null; createdAt: string }>
}

export function AdminApp() {
  const { i18n } = useLingui()
  const [data, setData] = useState<AdminData | null>(null)
  const [status, setStatus] = useState('')

  async function load() {
    const response = await fetch('/api/admin')
    if (response.ok) setData(await response.json<AdminData>())
  }
  useEffect(() => { void load() }, [])

  async function post(body: unknown, form?: HTMLFormElement) {
    setStatus('')
    const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json<{ error?: string }>().catch(() => null)
    setStatus(response.ok ? i18n._('Saved') : result?.error || i18n._('Save failed'))
    if (response.ok) { form?.reset(); await load() }
  }

  if (!data) return <div className="grid h-dvh place-items-center"><LoaderCircle className="animate-spin" /></div>
  return (
    <main className="min-h-dvh bg-muted p-3 md:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex items-center gap-2"><Button asChild variant="ghost" size="icon"><Link to="/inbox" aria-label={i18n._('Back to inbox')}><ArrowLeft /></Link></Button><Shield /><h1 className="text-2xl font-semibold"><Trans id="Administration" /></h1></header>
        {status && <p role="status" className="rounded-md bg-background p-3 text-sm">{status}</p>}
        <Card>
          <CardHeader><CardTitle><Trans id="Accounts" /></CardTitle><CardDescription><Trans id="Create, disable and assign roles." /></CardDescription></CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">{data.users.map((user) => <div key={user.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"><span className="font-medium">{user.name}</span><span className="text-muted-foreground">{user.email}</span><span className="rounded-full bg-muted px-2 py-0.5">{user.role}</span>{user.banned && <span className="text-red-600"><Trans id="Disabled" /></span>}<div className="ml-auto flex gap-1"><Button size="sm" variant="outline" onClick={() => post({ action: 'user:role', userId: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}>{user.role === 'admin' ? <Trans id="Make user" /> : <Trans id="Make admin" />}</Button><Button size="icon" variant="ghost" onClick={() => post({ action: 'user:ban', userId: user.id, banned: !user.banned })} aria-label={i18n._(user.banned ? 'Enable account' : 'Disable account')}>{user.banned ? <UserRoundCheck /> : <UserRoundX />}</Button></div></div>)}</div>
            <form className="grid gap-3 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'user:create', name: form.get('name'), email: form.get('email'), password: form.get('password'), role: form.get('role') }, event.currentTarget) }}>
              <Field label="Name" name="name" required /><Field label="Email" name="email" type="email" required /><Field label="Temporary password" name="password" type="password" minLength={12} required /><Select label="Role" name="role" options={[['user', i18n._('User')], ['admin', i18n._('Administrator')]]} /><Button className="self-end"><Plus /><Trans id="Create account" /></Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card><CardHeader><CardTitle><Trans id="Domains" /></CardTitle><CardDescription><Trans id="Cloudflare Email Routing domains" /></CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2">{data.domains.map((domain) => <div key={domain.id} className="rounded-md border p-3 text-sm"><strong>{domain.hostname}</strong><div className="text-muted-foreground">{domain.status} · routing {domain.routingEnabled ? '✓' : '–'} · sending {domain.sendingEnabled ? '✓' : '–'}</div></div>)}</div><form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'domain:create', hostname: form.get('hostname') }, event.currentTarget) }}><Field label="Domain" name="hostname" placeholder="example.com" required /><Button><Plus /><Trans id="Add" /></Button></form></CardContent></Card>

          <Card><CardHeader><CardTitle><Trans id="Mailboxes" /></CardTitle><CardDescription><Trans id="Personal and shared mailboxes" /></CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2">{data.mailboxes.map((mailbox) => <div key={mailbox.id} className="rounded-md border p-3 text-sm"><strong>{mailbox.localPart}@{mailbox.hostname}</strong><div className="text-muted-foreground">{mailbox.type} · {data.users.find((user) => user.id === mailbox.userId)?.name}</div></div>)}</div><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'mailbox:create', userId: form.get('userId'), domainId: form.get('domainId'), localPart: form.get('localPart'), displayName: form.get('displayName'), mailboxType: form.get('mailboxType') }, event.currentTarget) }}><Select label="Owner" name="userId" options={data.users.map((user) => [user.id, user.name])} /><Select label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname])} /><Field label="Address" name="localPart" required /><Field label="Display name" name="displayName" /><Select label="Mailbox type" name="mailboxType" options={[['personal', i18n._('Personal')], ['shared', i18n._('Shared')]]} /><Button className="self-end" disabled={!data.domains.length}><Plus /><Trans id="Create mailbox" /></Button></form></CardContent></Card>

          <Card><CardHeader><CardTitle><Trans id="Aliases" /></CardTitle><CardDescription><Trans id="Additional addresses for a mailbox" /></CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2">{data.aliases.map((alias) => <div key={alias.id} className="rounded-md border p-3 text-sm">{alias.localPart}@{data.domains.find((domain) => domain.id === alias.domainId)?.hostname} → {mailboxAddress(data, alias.mailboxId)}</div>)}</div><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'alias:create', mailboxId: form.get('mailboxId'), domainId: form.get('domainId'), localPart: form.get('localPart') }, event.currentTarget) }}><Select label="Mailbox" name="mailboxId" options={data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)])} /><Select label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname])} /><Field label="Alias address" name="localPart" required /><Button className="self-end" disabled={!data.mailboxes.length}><Plus /><Trans id="Add alias" /></Button></form></CardContent></Card>

          <Card><CardHeader><CardTitle><Trans id="Shared access" /></CardTitle><CardDescription><Trans id="Delegate a mailbox with explicit permissions." /></CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-2">{data.access.map((access) => <div key={access.id} className="rounded-md border p-3 text-sm">{data.users.find((user) => user.id === access.userId)?.name} → {mailboxAddress(data, access.mailboxId)} · {access.permission}</div>)}</div><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'access:set', mailboxId: form.get('mailboxId'), userId: form.get('userId'), permission: form.get('permission') }) }}><Select label="Mailbox" name="mailboxId" options={data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)])} /><Select label="Account" name="userId" options={data.users.map((user) => [user.id, user.name])} /><Select label="Permission" name="permission" options={['read_only', 'send_as', 'send_on_behalf', 'full_access'].map((value) => [value, value])} /><Button className="self-end" disabled={!data.mailboxes.length}><Trans id="Save access" /></Button></form></CardContent></Card>
        </div>

        <Card><CardHeader><CardTitle><Trans id="Domain routing" /></CardTitle><CardDescription><Trans id="Store, forward or reject matching recipients." /></CardDescription></CardHeader><CardContent className="grid gap-5"><div className="grid gap-2">{data.rules.map((rule) => <div key={rule.id} className="rounded-md border p-3 text-sm"><strong>{rule.name}</strong>: {rule.pattern} → {rule.action} · {rule.matchCount} <Trans id="matches" /></div>)}</div><form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'rule:create', domainId: form.get('domainId'), mailboxId: form.get('mailboxId') || null, name: form.get('name'), pattern: form.get('pattern'), actionType: form.get('actionType'), forwardTo: form.get('forwardTo'), keepCopy: form.get('keepCopy') === 'on' }, event.currentTarget) }}><Select label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname])} /><Select label="Mailbox" name="mailboxId" options={[['', i18n._('No mailbox')], ...data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)] as [string, string])]} /><Field label="Rule name" name="name" required /><Field label="Recipient pattern" name="pattern" required /><Select label="Action" name="actionType" options={['store', 'forward', 'reject'].map((value) => [value, value])} /><Field label="Forward to" name="forwardTo" type="email" /><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="keepCopy" /><Trans id="Keep a copy" /></label><Button className="w-fit" disabled={!data.domains.length}><Plus /><Trans id="Add rule" /></Button></form></CardContent></Card>
        <Card><CardHeader><CardTitle><Trans id="Audit log" /></CardTitle></CardHeader><CardContent className="grid gap-2">{data.logs.map((log) => <div key={log.id} className="rounded-md border p-3 text-sm"><strong>{log.action}</strong> · {new Date(log.createdAt).toLocaleString(i18n.locale)}<small className="block break-all text-muted-foreground">{log.metadata}</small></div>)}</CardContent></Card>
      </div>
    </main>
  )
}

function mailboxAddress(data: AdminData, id: string) {
  const mailbox = data.mailboxes.find((item) => item.id === id)
  return mailbox ? `${mailbox.localPart}@${mailbox.hostname}` : id
}

function Field({ label, ...props }: React.ComponentProps<typeof Input> & { label: string }) {
  return <label className="grid gap-2 text-sm font-medium"><Trans id={label} /><Input {...props} /></label>
}

function Select({ label, name, options }: { label: string; name: string; options: Array<Array<string>> }) {
  return <label className="grid gap-2 text-sm font-medium"><Trans id={label} /><select className="h-10 rounded-md border bg-background px-3" name={name}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
}
