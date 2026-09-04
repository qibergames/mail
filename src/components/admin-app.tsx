import { Trans, useLingui } from '@lingui/react'
import type { LucideIcon } from 'lucide-react'
import { AtSign, Globe2, LoaderCircle, Mail, Plus, Route as RouteIcon, ScrollText, UserRoundCheck, UserRoundCog, UserRoundX, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'

type AdminData = {
  users: Array<{ id: string; name: string; email: string; role: 'admin' | 'user'; banned: boolean }>
  domains: Array<{ id: string; hostname: string; status: string; routingEnabled: boolean; sendingEnabled: boolean }>
  mailboxes: Array<{ id: string; userId: string; domainId: string; localPart: string; hostname: string; displayName: string | null; type: 'personal' | 'shared'; disabled: boolean }>
  aliases: Array<{ id: string; mailboxId: string; domainId: string; localPart: string }>
  access: Array<{ id: string; mailboxId: string; userId: string; permission: string }>
  rules: Array<{ id: string; domainId: string; mailboxId: string | null; name: string | null; action: string; pattern: string; matchCount: number }>
  logs: Array<{ id: string; actorUserId: string | null; action: string; metadata: string | null; createdAt: string }>
}

type AdminSection = 'accounts' | 'audit' | 'domains' | 'mailboxes' | 'aliases' | 'access' | 'routing'

const sectionDetails: Record<AdminSection, { title: string; description: string; action?: string; icon: LucideIcon }> = {
  accounts: { title: 'Accounts', description: 'Create, disable and assign roles.', action: 'Create account', icon: Users },
  audit: { title: 'Audit log', description: 'Administrative activity across QiberMail.', icon: ScrollText },
  domains: { title: 'Domains', description: 'Cloudflare Email Routing domains', action: 'Add domain', icon: Globe2 },
  mailboxes: { title: 'Mailboxes', description: 'Personal and shared mailboxes', action: 'Create mailbox', icon: Mail },
  aliases: { title: 'Aliases', description: 'Additional addresses for a mailbox', action: 'Add alias', icon: AtSign },
  access: { title: 'Shared access', description: 'Delegate a mailbox with explicit permissions.', action: 'Grant access', icon: UserRoundCog },
  routing: { title: 'Domain routing', description: 'Store, forward or reject matching recipients.', action: 'Add rule', icon: RouteIcon },
}

export function AdminApp({ section }: { section: AdminSection }) {
  const { i18n } = useLingui()
  const [data, setData] = useState<AdminData | null>(null)
  const [status, setStatus] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load() {
    const response = await fetch('/api/admin')
    if (response.ok) setData(await response.json<AdminData>())
  }
  useEffect(() => { void load() }, [])

  async function post(body: unknown, form?: HTMLFormElement) {
    setBusy(true)
    setStatus('')
    const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json<{ error?: string }>().catch(() => null)
    setStatus(response.ok ? i18n._('Saved') : result?.error || i18n._('Save failed'))
    setBusy(false)
    if (response.ok) { form?.reset(); setCreateOpen(false); await load() }
  }

  if (!data) return <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin" /></div>

  const details = sectionDetails[section]
  const items = section === 'accounts' ? data.users.length
    : section === 'audit' ? data.logs.length
      : section === 'domains' ? data.domains.length
        : section === 'mailboxes' ? data.mailboxes.length
          : section === 'aliases' ? data.aliases.length
            : section === 'access' ? data.access.length
              : data.rules.length

  return <>
    {status && <p role="status" className="rounded-xl border bg-background p-3 text-sm shadow-sm">{status}</p>}
    <section className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><details.icon /></span>
        <div className="min-w-0"><h2 className="text-2xl font-semibold">{i18n._(details.title)}</h2><p className="text-sm text-muted-foreground">{i18n._(details.description)}</p></div>
        <span className="w-fit rounded-full bg-muted px-3 py-1 text-sm font-medium sm:ml-auto">{items}</span>
        {details.action && <Button onClick={() => setCreateOpen(true)}><Plus />{i18n._(details.action)}</Button>}
      </div>

      {items === 0 && <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center text-sm text-muted-foreground"><Trans id="No records yet." /></div>}
      {section === 'accounts' && <ItemGrid>{data.users.map((user) => <AdminItem key={user.id} icon={Users} title={user.name} description={user.email} badges={<><Badge>{user.role}</Badge>{user.banned && <Badge danger><Trans id="Disabled" /></Badge>}</>} actions={<><Button size="sm" variant="outline" disabled={busy} onClick={() => post({ action: 'user:role', userId: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}>{user.role === 'admin' ? <Trans id="Make user" /> : <Trans id="Make admin" />}</Button><Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => post({ action: 'user:ban', userId: user.id, banned: !user.banned })} aria-label={i18n._(user.banned ? 'Enable account' : 'Disable account')}>{user.banned ? <UserRoundCheck /> : <UserRoundX />}</Button></>} />)}</ItemGrid>}
      {section === 'domains' && <ItemGrid>{data.domains.map((domain) => <AdminItem key={domain.id} icon={Globe2} title={domain.hostname} description={domain.status} badges={<><Badge active={domain.routingEnabled}>routing</Badge><Badge active={domain.sendingEnabled}>sending</Badge></>} />)}</ItemGrid>}
      {section === 'mailboxes' && <ItemGrid>{data.mailboxes.map((mailbox) => <AdminItem key={mailbox.id} icon={Mail} title={`${mailbox.localPart}@${mailbox.hostname}`} description={mailbox.displayName || data.users.find((user) => user.id === mailbox.userId)?.name || '—'} badges={<Badge>{mailbox.type}</Badge>} />)}</ItemGrid>}
      {section === 'aliases' && <ItemGrid>{data.aliases.map((alias) => <AdminItem key={alias.id} icon={AtSign} title={`${alias.localPart}@${data.domains.find((domain) => domain.id === alias.domainId)?.hostname}`} description={`→ ${mailboxAddress(data, alias.mailboxId)}`} />)}</ItemGrid>}
      {section === 'access' && <ItemGrid>{data.access.map((access) => <AdminItem key={access.id} icon={UserRoundCog} title={data.users.find((user) => user.id === access.userId)?.name || access.userId} description={mailboxAddress(data, access.mailboxId)} badges={<Badge>{access.permission}</Badge>} />)}</ItemGrid>}
      {section === 'routing' && <ItemGrid>{data.rules.map((rule) => <AdminItem key={rule.id} icon={RouteIcon} title={rule.name || rule.pattern} description={`${rule.pattern} → ${rule.action}`} badges={<Badge>{rule.matchCount} {i18n._('matches')}</Badge>} />)}</ItemGrid>}
      {section === 'audit' && <div className="grid gap-2">{data.logs.map((log) => <AdminItem key={log.id} icon={ScrollText} title={log.action} description={new Date(log.createdAt).toLocaleString(i18n.locale)} meta={log.metadata} />)}</div>}
    </section>

    <AdminModal open={createOpen} title={i18n._(details.action || details.title)} onClose={() => setCreateOpen(false)}>
      {section === 'accounts' && <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'user:create', name: form.get('name'), email: form.get('email'), password: form.get('password'), role: form.get('role') }, event.currentTarget) }}><Field label="Name" name="name" required /><Field label="Email" name="email" type="email" required /><Field label="Temporary password" name="password" type="password" minLength={12} required /><Select label="Role" name="role" options={[["user", i18n._('User')], ['admin', i18n._('Administrator')]]} /><FormActions busy={busy} close={() => setCreateOpen(false)} label="Create account" /></form>}
      {section === 'domains' && <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'domain:create', hostname: form.get('hostname') }, event.currentTarget) }}><Field label="Domain" name="hostname" placeholder="example.com" required /><FormActions busy={busy} close={() => setCreateOpen(false)} label="Add domain" /></form>}
      {section === 'mailboxes' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'mailbox:create', userId: form.get('userId'), domainId: form.get('domainId'), localPart: form.get('localPart'), displayName: form.get('displayName'), mailboxType: form.get('mailboxType') }, event.currentTarget) }}><Select label="Owner" name="userId" options={data.users.map((user) => [user.id, user.name])} /><Select label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname])} /><Field label="Address" name="localPart" required /><Field label="Display name" name="displayName" /><Select label="Mailbox type" name="mailboxType" options={[["personal", i18n._('Personal')], ['shared', i18n._('Shared')]]} /><FormActions busy={busy || !data.domains.length} close={() => setCreateOpen(false)} label="Create mailbox" /></form>}
      {section === 'aliases' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'alias:create', mailboxId: form.get('mailboxId'), domainId: form.get('domainId'), localPart: form.get('localPart') }, event.currentTarget) }}><Select label="Mailbox" name="mailboxId" options={data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)])} /><Select label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname])} /><Field label="Alias address" name="localPart" required /><FormActions busy={busy || !data.mailboxes.length} close={() => setCreateOpen(false)} label="Add alias" /></form>}
      {section === 'access' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'access:set', mailboxId: form.get('mailboxId'), userId: form.get('userId'), permission: form.get('permission') }, event.currentTarget) }}><Select label="Mailbox" name="mailboxId" options={data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)])} /><Select label="Account" name="userId" options={data.users.map((user) => [user.id, user.name])} /><Select label="Permission" name="permission" options={['read_only', 'send_as', 'send_on_behalf', 'full_access'].map((value) => [value, value])} /><FormActions busy={busy || !data.mailboxes.length} close={() => setCreateOpen(false)} label="Save access" /></form>}
      {section === 'routing' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'rule:create', domainId: form.get('domainId'), mailboxId: form.get('mailboxId') || null, name: form.get('name'), pattern: form.get('pattern'), actionType: form.get('actionType'), forwardTo: form.get('forwardTo'), keepCopy: form.get('keepCopy') === 'on' }, event.currentTarget) }}><Select label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname])} /><Select label="Mailbox" name="mailboxId" options={[["", i18n._('No mailbox')], ...data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)] as [string, string])]} /><Field label="Rule name" name="name" required /><Field label="Recipient pattern" name="pattern" required /><Select label="Action" name="actionType" options={['store', 'forward', 'reject'].map((value) => [value, value])} /><Field label="Forward to" name="forwardTo" type="email" /><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="keepCopy" /><Trans id="Keep a copy" /></label><FormActions busy={busy || !data.domains.length} close={() => setCreateOpen(false)} label="Add rule" /></form>}
    </AdminModal>
  </>
}

function AdminModal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    if (!open && ref.current?.open) ref.current.close()
  }, [open])
  return <dialog ref={ref} onCancel={onClose} className="m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/60">
    <div className="flex items-center border-b px-5 py-4"><h2 className="text-xl font-semibold">{title}</h2><Button className="ml-auto" type="button" size="icon" variant="ghost" onClick={onClose}><X /><span className="sr-only"><Trans id="Close" /></span></Button></div>
    <div className="p-5">{children}</div>
  </dialog>
}

function AdminItem({ icon: Icon, title, description, meta, badges, actions }: { icon: LucideIcon; title: string; description?: string; meta?: string | null; badges?: React.ReactNode; actions?: React.ReactNode }) {
  return <article className="flex min-w-0 gap-3 rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon className="size-5" /></span>
    <div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{title}</h3>{description && <p className="truncate text-sm text-muted-foreground">{description}</p>}{meta && <p className="mt-2 break-all text-xs text-muted-foreground">{meta}</p>}<div className="mt-3 flex flex-wrap items-center gap-2">{badges}{actions && <span className="ml-auto flex items-center gap-1">{actions}</span>}</div></div>
  </article>
}

function ItemGrid({ children }: { children: React.ReactNode }) { return <div className="grid gap-3 md:grid-cols-2">{children}</div> }
function Badge({ children, active, danger }: { children: React.ReactNode; active?: boolean; danger?: boolean }) { return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', active && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600', danger && 'border-red-500/30 bg-red-500/10 text-red-600', !active && !danger && 'bg-muted text-muted-foreground')}>{children}</span> }
function FormActions({ busy, close, label }: { busy: boolean; close: () => void; label: string }) { const { i18n } = useLingui(); return <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={close}><Trans id="Cancel" /></Button><Button disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Plus />}{i18n._(label)}</Button></div> }

function mailboxAddress(data: AdminData, id: string) {
  const mailbox = data.mailboxes.find((item) => item.id === id)
  return mailbox ? `${mailbox.localPart}@${mailbox.hostname}` : id
}

function Field({ label, ...props }: React.ComponentProps<typeof Input> & { label: string }) { const { i18n } = useLingui(); return <label className="grid gap-2 text-sm font-medium">{i18n._(label)}<Input {...props} /></label> }
function Select({ label, name, options }: { label: string; name: string; options: Array<Array<string>> }) { const { i18n } = useLingui(); return <label className="grid gap-2 text-sm font-medium">{i18n._(label)}<select className="h-10 rounded-md border bg-background px-3" name={name}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label> }
