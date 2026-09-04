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

const sectionDetails: Record<AdminSection, { title: string; description: string; action?: string; hint?: string; icon: LucideIcon }> = {
  accounts: { title: 'Accounts', description: 'Create, disable and assign roles.', action: 'Create account', hint: 'Create a sign-in account and, optionally, its first mailbox.', icon: Users },
  audit: { title: 'Audit log', description: 'Administrative activity across QiberMail.', icon: ScrollText },
  domains: { title: 'Domains', description: 'Cloudflare Email Routing domains', action: 'Add domain', hint: 'Connect a Cloudflare zone and provision routing automatically.', icon: Globe2 },
  mailboxes: { title: 'Mailboxes', description: 'Personal and shared mailboxes', action: 'Create mailbox', hint: 'Add an address and provision its routing rule automatically.', icon: Mail },
  aliases: { title: 'Aliases', description: 'Additional addresses for a mailbox', action: 'Add alias', hint: 'Route an additional address to an existing mailbox.', icon: AtSign },
  access: { title: 'Shared access', description: 'Delegate a mailbox with explicit permissions.', action: 'Grant access', hint: 'Let another account read or send from a mailbox.', icon: UserRoundCog },
  routing: { title: 'Domain routing', description: 'Store, forward or reject matching recipients.', action: 'Add rule', hint: 'Match recipients on a domain and store, forward or reject them.', icon: RouteIcon },
}

export function AdminApp({ section }: { section: AdminSection }) {
  const { i18n } = useLingui()
  const [data, setData] = useState<AdminData | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mailboxType, setMailboxType] = useState<'personal' | 'shared'>('personal')
  const [ruleMode, setRuleMode] = useState<'catch_all' | 'pattern'>('catch_all')
  const [ruleAction, setRuleAction] = useState<'store' | 'forward' | 'reject'>('store')

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
    {!createOpen && <StatusBanner status={status} />}
    <section className="space-y-4">
      {items === 0 && <EmptyState icon={details.icon}><Trans id="No records yet." /></EmptyState>}
      {section === 'accounts' && <ItemGrid>{data.users.map((user) => <ItemCard key={user.id} icon={Users} title={<Link to="/admin/accounts/$userId" params={{ userId: user.id }} className="hover:underline">{user.name}</Link>} description={user.email} badges={<><Badge>{user.role}</Badge>{user.banned && <Badge danger><Trans id="Disabled" /></Badge>}</>} actions={<><Button size="sm" variant="outline" disabled={busy} onClick={() => post({ action: 'user:role', userId: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}>{user.role === 'admin' ? <Trans id="Make user" /> : <Trans id="Make admin" />}</Button><Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => post({ action: 'user:ban', userId: user.id, banned: !user.banned })} aria-label={i18n._(user.banned ? 'Enable account' : 'Disable account')}>{user.banned ? <UserRoundCheck /> : <UserRoundX />}</Button></>} />)}</ItemGrid>}
      {section === 'domains' && <ItemGrid>{data.domains.map((domain) => <ItemCard key={domain.id} icon={Globe2} title={<Link to="/admin/domains/$domainId" params={{ domainId: domain.id }} className="after:absolute after:inset-0 hover:underline">{domain.hostname}</Link>} description={i18n._(domain.status)} badges={<><Badge active={domain.routingEnabled}>routing</Badge><Badge active={domain.sendingEnabled}>sending</Badge></>} actions={<ChevronRight className="size-4 text-muted-foreground" />} />)}</ItemGrid>}
      {section === 'mailboxes' && <ItemGrid>{data.mailboxes.map((mailbox) => <ItemCard key={mailbox.id} icon={Mail} title={`${mailbox.localPart}@${mailbox.hostname}`} description={mailbox.displayName || data.users.find((user) => user.id === mailbox.userId)?.name || '—'} badges={<Badge>{mailbox.type}</Badge>} />)}</ItemGrid>}
      {section === 'aliases' && <ItemGrid>{data.aliases.map((alias) => <ItemCard key={alias.id} icon={AtSign} title={`${alias.localPart}@${data.domains.find((domain) => domain.id === alias.domainId)?.hostname}`} description={`→ ${mailboxAddress(data, alias.mailboxId)}`} />)}</ItemGrid>}
      {section === 'access' && <ItemGrid>{data.access.map((access) => <ItemCard key={access.id} icon={UserRoundCog} title={data.users.find((user) => user.id === access.userId)?.name || access.userId} description={mailboxAddress(data, access.mailboxId)} badges={<Badge>{access.permission}</Badge>} />)}</ItemGrid>}
      {section === 'routing' && <ItemGrid>{data.rules.map((rule) => <ItemCard key={rule.id} icon={RouteIcon} title={rule.name || rule.pattern} description={`${data.domains.find((domain) => domain.id === rule.domainId)?.hostname ?? ''} · ${rule.pattern === '*' ? i18n._('every unmatched address') : rule.pattern} → ${rule.action}${rule.mailboxId ? ` ${mailboxAddress(data, rule.mailboxId)}` : ''}`} badges={<>{rule.pattern === '*' && <Badge active>catch-all</Badge>}<Badge>{rule.matchCount} {i18n._('matches')}</Badge></>} />)}</ItemGrid>}
      {section === 'audit' && <div className="grid gap-2">{data.logs.map((log) => <ItemCard key={log.id} icon={ScrollText} title={log.action} description={new Date(log.createdAt).toLocaleString(i18n.locale)} meta={log.metadata} />)}</div>}
    </section>

    <AdminModal open={createOpen} title={i18n._(details.action || details.title)} onClose={() => { setCreateOpen(false); setStatus(null) }} status={status} description={details.hint}>
      {section === 'accounts' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'user:create', name: form.get('name'), localPart: form.get('localPart'), domainId: form.get('domainId'), password: form.get('password'), role: form.get('role'), createMailbox: form.get('createMailbox') === 'on' }, event.currentTarget) }}><Field label="Name" name="name" required /><div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2"><Field label="Address" name="localPart" placeholder="info" required /><span className="pb-2.5 text-muted-foreground">@</span><SelectField label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname] as [string, string])} /></div><Field label="Temporary password" name="password" type="password" minLength={12} required /><SelectField label="Role" name="role" options={[['user', i18n._('User')], ['admin', i18n._('Administrator')]]} /><CheckboxField label="Create a mailbox for this address" name="createMailbox" defaultChecked className="sm:col-span-2" /><FormActions busy={busy || !data.domains.length} close={() => setCreateOpen(false)} label="Create account" /></form>}
      {section === 'domains' && <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'domain:create', hostname: form.get('hostname') }, event.currentTarget) }}><Field label="Domain" name="hostname" placeholder="example.com" required /><FormActions busy={busy} close={() => setCreateOpen(false)} label="Add domain" /></form>}
      {section === 'mailboxes' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'mailbox:create', userId: form.get('userId'), domainId: form.get('domainId'), localPart: form.get('localPart'), displayName: form.get('displayName'), mailboxType }, event.currentTarget) }}>
        <SelectField label="Type" name="mailboxType" value={mailboxType} onChange={(event) => setMailboxType(event.target.value as 'personal' | 'shared')} className="sm:col-span-2 sm:w-64" options={[['personal', i18n._('Personal inbox')], ['shared', i18n._('Shared inbox')]]} />
        <InfoNote>{mailboxType === 'shared' ? <Trans id="After creating the shared inbox, choose which accounts can access it under Shared access." /> : <Trans id="A personal inbox belongs to one account, which signs in and uses it directly." />}</InfoNote>
        <SelectField label={mailboxType === 'shared' ? 'Owner' : 'Account'} name="userId" options={data.users.map((user) => [user.id, user.name] as [string, string])} />
        <Field label="Display name" name="displayName" placeholder={mailboxType === 'shared' ? i18n._('Support team') : ''} />
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:col-span-2"><Field label="Address" name="localPart" placeholder={mailboxType === 'shared' ? 'support' : 'name'} required /><span className="pb-2.5 text-muted-foreground">@</span><SelectField label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname] as [string, string])} /></div>
        <FormActions busy={busy || !data.domains.length} close={() => setCreateOpen(false)} label="Create mailbox" />
      </form>}
      {section === 'aliases' && <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'alias:create', mailboxId: form.get('mailboxId'), domainId: form.get('domainId'), localPart: form.get('localPart') }, event.currentTarget) }}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2"><Field label="Alias address" name="localPart" placeholder="hello" required /><span className="pb-2.5 text-muted-foreground">@</span><SelectField label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname] as [string, string])} /></div>
        <SelectField label="Deliver to mailbox" name="mailboxId" options={data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)] as [string, string])} />
        <FormActions busy={busy || !data.mailboxes.length} close={() => setCreateOpen(false)} label="Add alias" />
      </form>}
      {section === 'access' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'access:set', mailboxId: form.get('mailboxId'), userId: form.get('userId'), permission: form.get('permission') }, event.currentTarget) }}><SelectField label="Mailbox" name="mailboxId" options={data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)] as [string, string])} /><SelectField label="Account" name="userId" options={data.users.map((user) => [user.id, user.name] as [string, string])} /><SelectField label="Permission" name="permission" options={['read_only', 'send_as', 'send_on_behalf', 'full_access']} /><FormActions busy={busy || !data.mailboxes.length} close={() => setCreateOpen(false)} label="Save access" /></form>}
      {section === 'routing' && <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const catchAll = ruleMode === 'catch_all'; void post({ action: 'rule:create', domainId: form.get('domainId'), mailboxId: form.get('mailboxId') || null, name: form.get('name') || (catchAll ? 'Catch-all' : form.get('pattern')), pattern: catchAll ? '*' : form.get('pattern'), actionType: ruleAction, forwardTo: form.get('forwardTo') ?? '', keepCopy: form.get('keepCopy') === 'on' }, event.currentTarget) }}>
        <SelectField label="Domain" name="domainId" options={data.domains.map((domain) => [domain.id, domain.hostname] as [string, string])} />
        <SelectField label="Applies to" name="ruleMode" value={ruleMode} onChange={(event) => setRuleMode(event.target.value as 'catch_all' | 'pattern')} options={[['catch_all', i18n._('Every unmatched address (catch-all)')], ['pattern', i18n._('Addresses matching a pattern')]]} />
        {ruleMode === 'pattern'
          ? <Field label="Recipient pattern" name="pattern" placeholder="sales" required className="sm:col-span-2" />
          : <InfoNote><Trans id="Mail sent to any address on this domain that has no mailbox or alias will be handled by this rule." /></InfoNote>}
        <SelectField label="Action" name="actionType" value={ruleAction} onChange={(event) => setRuleAction(event.target.value as 'store' | 'forward' | 'reject')} options={[['store', i18n._('Deliver to a mailbox')], ['forward', i18n._('Forward to an external address')], ['reject', i18n._('Reject the message')]]} />
        {ruleAction === 'store' && <SelectField label="Deliver to mailbox" name="mailboxId" required options={data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)] as [string, string])} />}
        {ruleAction === 'forward' && <><Field label="Forward to" name="forwardTo" type="email" required /><SelectField label="Keep a copy in" name="mailboxId" options={[['', i18n._('No mailbox')], ...data.mailboxes.map((mailbox) => [mailbox.id, mailboxAddress(data, mailbox.id)] as [string, string])]} /><CheckboxField label="Keep a copy" name="keepCopy" defaultChecked /></>}
        {ruleAction === 'reject' && <InfoNote><Trans id="The sender receives a bounce and nothing is stored." /></InfoNote>}
        <Field label="Rule name" name="name" placeholder={ruleMode === 'catch_all' ? 'Catch-all' : ''} className="sm:col-span-2" />
        <FormActions busy={busy || !data.domains.length || (ruleAction === 'store' && !data.mailboxes.length)} close={() => setCreateOpen(false)} label="Add rule" />
      </form>}
    </AdminModal>
  </>
}

function AdminModal({ open, title, description, onClose, status, children }: { open: boolean; title: string; description?: string; onClose: () => void; status: Status; children: React.ReactNode }) {
  const { i18n } = useLingui()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    if (!open && ref.current?.open) ref.current.close()
  }, [open])
  return <dialog ref={ref} onCancel={onClose} className="m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm">
    <div className="flex items-start gap-3 border-b px-5 py-4"><div className="min-w-0 flex-1"><h2 className="text-xl font-semibold">{title}</h2>{description && <p className="mt-1 text-sm text-muted-foreground"><Trans id={description} /></p>}</div><Button className="shrink-0" type="button" size="icon" variant="ghost" onClick={onClose} title={i18n._('Close')}><X /><span className="sr-only"><Trans id="Close" /></span></Button></div>
    <div className="grid gap-4 p-5">{status?.tone === 'error' && <StatusBanner status={status} />}{children}</div>
  </dialog>
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary sm:col-span-2 dark:text-blue-300">{children}</p>
}

function FormActions({ busy, close, label }: { busy: boolean; close: () => void; label: string }) {
  const { i18n } = useLingui()
  return <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={close}><Trans id="Cancel" /></Button><Button disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Plus />}{i18n._(label)}</Button></div>
}

function mailboxAddress(data: AdminData, id: string) {
  const mailbox = data.mailboxes.find((item) => item.id === id)
  return mailbox ? `${mailbox.localPart}@${mailbox.hostname}` : id
}
