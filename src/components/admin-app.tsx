import { Trans, useLingui } from '@lingui/react'
import type { LucideIcon } from 'lucide-react'
import { AtSign, ChevronRight, Globe2, LoaderCircle, Mail, Plus, Route as RouteIcon, ScrollText, UserRoundCheck, UserRoundCog, UserRoundX, Users, X } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { Status } from './section-ui'
import { Badge, CheckboxField, EmptyState, Field, ItemCard, ItemGrid, Loading, SectionHeader, SelectField, StatusBanner } from './section-ui'
import { Button } from './ui/button'

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
  const [status, setStatus] = useState<Status>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load() {
    const response = await fetch('/api/admin')
    if (response.ok) setData(await response.json<AdminData>())
  }
  useEffect(() => { void load() }, [])

  async function post(body: unknown, form?: HTMLFormElement) {
    setBusy(true)
    setStatus(null)
    const response = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json<{ error?: string }>().catch(() => null)
    setStatus(response.ok ? { tone: 'success', text: i18n._('Saved') } : { tone: 'error', text: result?.error || i18n._('Save failed') })
    setBusy(false)
    if (response.ok) { form?.reset(); setCreateOpen(false); await load() }
  }

  if (!data) return <Loading />

  const details = sectionDetails[section]
  const items = section === 'accounts' ? data.users.length
    : section === 'audit' ? data.logs.length
      : section === 'domains' ? data.domains.length
        : section === 'mailboxes' ? data.mailboxes.length
          : section === 'aliases' ? data.aliases.length
            : section === 'access' ? data.access.length
              : data.rules.length

  return <>
    <SectionHeader icon={details.icon} title={details.title} description={details.description} count={items}>
      {details.action && <Button className="shrink-0" onClick={() => setCreateOpen(true)}><Plus />{i18n._(details.action)}</Button>}
    </SectionHeader>
    <StatusBanner status={status} />
    <section className="space-y-4">
      {items === 0 && <EmptyState icon={details.icon}><Trans id="No records yet." /></EmptyState>}
      {section === 'accounts' && <ItemGrid>{data.users.map((user) => <ItemCard key={user.id} icon={Users} title={user.name} description={user.email} badges={<><Badge>{user.role}</Badge>{user.banned && <Badge danger><Trans id="Disabled" /></Badge>}</>} actions={<><Button size="sm" variant="outline" disabled={busy} onClick={() => post({ action: 'user:role', userId: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}>{user.role === 'admin' ? <Trans id="Make user" /> : <Trans id="Make admin" />}</Button><Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => post({ action: 'user:ban', userId: user.id, banned: !user.banned })} aria-label={i18n._(user.banned ? 'Enable account' : 'Disable account')}>{user.banned ? <UserRoundCheck /> : <UserRoundX />}</Button></>} />)}</ItemGrid>}
      {section === 'domains' && <ItemGrid>{data.domains.map((domain) => <ItemCard key={domain.id} icon={Globe2} title={<Link to="/admin/domains/$domainId" params={{ domainId: domain.id }} className="after:absolute after:inset-0 hover:underline">{domain.hostname}</Link>} description={i18n._(domain.status)} badges={<><Badge active={domain.routingEnabled}>routing</Badge><Badge active={domain.sendingEnabled}>sending</Badge></>} actions={<ChevronRight className="size-4 text-muted-foreground" />} />)}</ItemGrid>}
      {section === 'mailboxes' && <ItemGrid>{data.mailboxes.map((mailbox) => <ItemCard key={mailbox.id} icon={Mail} title={`${mailbox.localPart}@${mailbox.hostname}`} description={mailbox.displayName || data.users.find((user) => user.id === mailbox.userId)?.name || '—'} badges={<Badge>{mailbox.type}</Badge>} />)}</ItemGrid>}
      {section === 'aliases' && <ItemGrid>{data.aliases.map((alias) => <ItemCard key={alias.id} icon={AtSign} title={`${alias.localPart}@${data.domains.find((domain) => domain.id === alias.domainId)?.hostname}`} description={`→ ${mailboxAddress(data, alias.mailboxId)}`} />)}</ItemGrid>}
      {section === 'access' && <ItemGrid>{data.access.map((access) => <ItemCard key={access.id} icon={UserRoundCog} title={data.users.find((user) => user.id === access.userId)?.name || access.userId} description={mailboxAddress(data, access.mailboxId)} badges={<Badge>{access.permission}</Badge>} />)}</ItemGrid>}
      {section === 'routing' && <ItemGrid>{data.rules.map((rule) => <ItemCard key={rule.id} icon={RouteIcon} title={rule.name || rule.pattern} description={`${rule.pattern} → ${rule.action}`} badges={<Badge>{rule.matchCount} {i18n._('matches')}</Badge>} />)}</ItemGrid>}
      {section === 'audit' && <div className="grid gap-2">{data.logs.map((log) => <ItemCard key={log.id} icon={ScrollText} title={log.action} description={new Date(log.createdAt).toLocaleString(i18n.locale)} meta={log.metadata} />)}</div>}
    </section>

    <AdminModal open={createOpen} title={i18n._(details.action || details.title)} onClose={() => setCreateOpen(false)}>
      {section === 'accounts' && <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'user:create', name: form.get('name'), email: form.get('email'), password: form.get('password'), role: form.get('role') }, event.currentTarget) }}><Field label="Name" name="name" required /><Field label="Email" name="email" type="email" required /><Field label="Temporary password" name="password" type="password" minLength={12} required /><SelectField label="Role" name="role" options={[['user', i18n._('User')], ['admin', i18n._('Administrator')]]} /><FormActions busy={busy} close={() => setCreateOpen(false)} label="Create account" /></form>}
      {section === 'domains' && <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'domain:create', hostname: form.get('hostname') }, event.currentTarget) }}><Field label="Domain" name="hostname" placeholder="example.com" required /><FormActions busy={busy} close={() => setCreateOpen(false)} label="Add domain" /></form>}
      {section === 'mailboxes' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'mailbox:create', userId: form.get('userId'), domainId: form.get('domainId'), localPart: form.get('localPart'), displayName: form.get('displayName'), mailboxType: form.get('mailboxType') }, event.currentTarget) }}><SelectField label="Owner" name="userId" options={data.users.map((user) => [user.id, user.name] as [string, string])} /><SelectField label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname] as [string, string])} /><Field label="Address" name="localPart" required /><Field label="Display name" name="displayName" /><SelectField label="Mailbox type" name="mailboxType" options={[['personal', i18n._('Personal')], ['shared', i18n._('Shared')]]} /><FormActions busy={busy || !data.domains.length} close={() => setCreateOpen(false)} label="Create mailbox" /></form>}
      {section === 'aliases' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'alias:create', mailboxId: form.get('mailboxId'), domainId: form.get('domainId'), localPart: form.get('localPart') }, event.currentTarget) }}><SelectField label="Mailbox" name="mailboxId" options={data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)] as [string, string])} /><SelectField label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname] as [string, string])} /><Field label="Alias address" name="localPart" required /><FormActions busy={busy || !data.mailboxes.length} close={() => setCreateOpen(false)} label="Add alias" /></form>}
      {section === 'access' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'access:set', mailboxId: form.get('mailboxId'), userId: form.get('userId'), permission: form.get('permission') }, event.currentTarget) }}><SelectField label="Mailbox" name="mailboxId" options={data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)] as [string, string])} /><SelectField label="Account" name="userId" options={data.users.map((user) => [user.id, user.name] as [string, string])} /><SelectField label="Permission" name="permission" options={['read_only', 'send_as', 'send_on_behalf', 'full_access']} /><FormActions busy={busy || !data.mailboxes.length} close={() => setCreateOpen(false)} label="Save access" /></form>}
      {section === 'routing' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'rule:create', domainId: form.get('domainId'), mailboxId: form.get('mailboxId') || null, name: form.get('name'), pattern: form.get('pattern'), actionType: form.get('actionType'), forwardTo: form.get('forwardTo'), keepCopy: form.get('keepCopy') === 'on' }, event.currentTarget) }}><SelectField label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname] as [string, string])} /><SelectField label="Mailbox" name="mailboxId" options={[['', i18n._('No mailbox')], ...data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)] as [string, string])]} /><Field label="Rule name" name="name" required /><Field label="Recipient pattern" name="pattern" required /><SelectField label="Action" name="actionType" options={['store', 'forward', 'reject']} /><Field label="Forward to" name="forwardTo" type="email" /><CheckboxField label="Keep a copy" name="keepCopy" /><FormActions busy={busy || !data.domains.length} close={() => setCreateOpen(false)} label="Add rule" /></form>}
    </AdminModal>
  </>
}

function AdminModal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const { i18n } = useLingui()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    if (!open && ref.current?.open) ref.current.close()
  }, [open])
  return <dialog ref={ref} onCancel={onClose} className="m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm">
    <div className="flex items-center border-b px-5 py-4"><h2 className="text-xl font-semibold">{title}</h2><Button className="ml-auto" type="button" size="icon" variant="ghost" onClick={onClose} title={i18n._('Close')}><X /><span className="sr-only"><Trans id="Close" /></span></Button></div>
    <div className="p-5">{children}</div>
  </dialog>
}

function FormActions({ busy, close, label }: { busy: boolean; close: () => void; label: string }) {
  const { i18n } = useLingui()
  return <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={close}><Trans id="Cancel" /></Button><Button disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Plus />}{i18n._(label)}</Button></div>
}

function mailboxAddress(data: AdminData, id: string) {
  const mailbox = data.mailboxes.find((item) => item.id === id)
  return mailbox ? `${mailbox.localPart}@${mailbox.hostname}` : id
}
