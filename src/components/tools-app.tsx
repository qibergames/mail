import { Trans, useLingui } from '@lingui/react'
import type { LucideIcon } from 'lucide-react'
import { CalendarDays, ContactRound, Download, FileText, FolderOpen, Import, KeyRound, LoaderCircle, Lock, Play, Plus, Server, ShieldCheck, Trash2, Upload, User, Webhook } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Status } from './section-ui'
import { Badge, CheckboxField, EmptyState, Field, Loading, SectionHeader, SelectField, StatusBanner, TextAreaField } from './section-ui'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { createImportBatches } from '@/lib/email/import-client'

type ToolData = {
  contacts: Array<{ id: string; email: string; displayName: string | null; blocked: boolean }>
  templates: Array<{ id: string; name: string; subject: string; textBody: string }>
  events: Array<{ id: string; title: string; location: string; startsAt: string; endsAt: string }>
  apiKeys: Array<{ id: string; name: string; prefix: string; scopes: string; lastUsedAt: string | null }>
  webhooks: Array<{ id: string; description: string | null; url: string; events: string; enabled: boolean }>
  deliveries: Array<{ id: string; webhookId: string; eventType: string; status: string; attempts: number; error: string | null }>
}
type Mailbox = { id: string; address: string }
type ToolsSection = 'contacts' | 'templates' | 'calendar' | 'api-keys' | 'webhooks' | 'import-export'

const sectionDetails: Record<ToolsSection, { title: string; description: string; icon: LucideIcon }> = {
  contacts: { title: 'Contacts and blocklist', description: 'Manage contacts and blocked senders.', icon: ContactRound },
  templates: { title: 'Templates', description: 'Reusable drafts for common replies.', icon: FileText },
  calendar: { title: 'Calendar', description: 'Events with email invitations.', icon: CalendarDays },
  'api-keys': { title: 'API keys', description: 'Use Bearer keys with the QiberMail v1 API.', icon: KeyRound },
  webhooks: { title: 'Webhooks', description: 'Signed delivery for received and sent messages.', icon: Webhook },
  'import-export': { title: 'Mail import and export', description: 'Import RFC 822 .eml or Unix .mbox files, or export accessible mailboxes as mbox.', icon: Import },
}

export function ToolsApp({ section }: { section: ToolsSection }) {
  const { i18n } = useLingui()
  const [data, setData] = useState<ToolData | null>(null)
  const [mailboxes, setMailboxes] = useState<Array<Mailbox>>([])
  const [transferMailboxId, setTransferMailboxId] = useState('')
  const [status, setStatus] = useState<Status>(null)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)

  async function load() {
    const [tools, boxes] = await Promise.all([fetch('/api/tools'), fetch('/api/mailboxes')])
    if (tools.ok) setData(await tools.json<ToolData>())
    if (boxes.ok) setMailboxes(await boxes.json<Array<Mailbox>>())
  }
  useEffect(() => { void load() }, [])

  async function post(body: unknown, form?: HTMLFormElement) {
    setStatus(null)
    const response = await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json<{ key?: string; error?: string }>().catch(() => null)
    setStatus(result?.key ? { tone: 'success', text: `${i18n._('Copy this key now')}: ${result.key}` } : response.ok ? { tone: 'success', text: i18n._('Saved') } : { tone: 'error', text: result?.error || i18n._('Save failed') })
    if (response.ok) { form?.reset(); await load() }
  }
  async function remove(kind: string, id: string) {
    if ((await fetch(`/api/tools?kind=${kind}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })).ok) await load()
  }
  async function importFiles(files: File[]) {
    const mailboxId = transferMailboxId || mailboxes[0]?.id
    if (!mailboxId || !files.length) return
    setStatus(null)
    setImportProgress({ current: 0, total: 0 })
    try {
      const batches = await createImportBatches(files)
      let imported = 0
      let skipped = 0
      const errors: string[] = []
      for (const [index, batch] of batches.entries()) {
        setImportProgress({ current: index + 1, total: batches.length })
        const form = new FormData()
        form.set('mailboxId', mailboxId)
        batch.forEach((file) => form.append('files', file))
        const response = await fetch('/api/import', { method: 'POST', body: form })
        const result = await response.json<{ imported?: number; skipped?: number; errors?: string[]; error?: string }>().catch(() => null)
        if (!response.ok) throw new Error(result?.error ?? i18n._('Import failed'))
        imported += result?.imported ?? 0
        skipped += result?.skipped ?? 0
        errors.push(...(result?.errors ?? []))
      }
      setStatus({ tone: 'success', text: `${i18n._('Import complete')}: ${imported} · ${i18n._('Skipped')}: ${skipped}${errors.length ? ` · ${errors.slice(0, 3).join(' · ')}` : ''}` })
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : i18n._('Import failed') })
    } finally {
      setImportProgress(null)
    }
  }
  if (!data) return <Loading />

  const details = sectionDetails[section]
  const count = section === 'contacts' ? data.contacts.length
    : section === 'templates' ? data.templates.length
      : section === 'calendar' ? data.events.length
        : section === 'api-keys' ? data.apiKeys.length
          : section === 'webhooks' ? data.webhooks.length
            : undefined

  return <>
    <SectionHeader icon={details.icon} title={details.title} description={details.description} count={count} />
    {importProgress ? <ImportProgress current={importProgress.current} total={importProgress.total} /> : <StatusBanner status={status} />}
    {count === 0 && <EmptyState icon={details.icon}><Trans id="No records yet." /></EmptyState>}

    {section === 'contacts' && <>
      {data.contacts.length > 0 && <div className="grid gap-2">
        {data.contacts.map((contact) => <Row key={contact.id} icon={ContactRound} title={contact.displayName || contact.email} meta={contact.displayName ? contact.email : undefined} badges={contact.blocked && <Badge danger><Trans id="blocked" /></Badge>} actions={<>
          <Button size="sm" variant="outline" onClick={() => post({ action: 'contact:block', id: contact.id, blocked: !contact.blocked })}>{contact.blocked ? <Trans id="Unblock" /> : <Trans id="Block" />}</Button>
          <Delete onClick={() => remove('contact', contact.id)} />
        </>} />)}
      </div>}
      <AddCard title="Add contact">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'contact:create', email: form.get('email'), displayName: form.get('displayName'), blocked: false }, event.currentTarget) }}>
          <Field label="Display name" name="displayName" />
          <Field label="Email" name="email" type="email" required />
          <div className="flex justify-end sm:col-span-2"><Button><Plus /><Trans id="Add contact" /></Button></div>
        </form>
      </AddCard>
    </>}

    {section === 'templates' && <>
      {data.templates.length > 0 && <div className="grid gap-2">
        {data.templates.map((template) => <Row key={template.id} icon={FileText} title={template.name} meta={template.subject} actions={<Delete onClick={() => remove('template', template.id)} />} />)}
      </div>}
      <AddCard title="Add template">
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'template:create', name: form.get('name'), subject: form.get('subject'), textBody: form.get('textBody') }, event.currentTarget) }}>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Template name" name="name" required /><Field label="Subject" name="subject" /></div>
          <TextAreaField label="Message" name="textBody" />
          <div className="flex justify-end"><Button><Plus /><Trans id="Add template" /></Button></div>
        </form>
      </AddCard>
    </>}

    {section === 'calendar' && <>
      {data.events.length > 0 && <div className="grid gap-2">
        {data.events.map((event) => <Row key={event.id} icon={CalendarDays} title={event.title} meta={`${new Date(event.startsAt).toLocaleString(i18n.locale)}${event.location ? ` · ${event.location}` : ''}`} actions={<Delete onClick={() => remove('event', event.id)} />} />)}
      </div>}
      <AddCard title="Add event">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const values = (name: string) => String(form.get(name)); void post({ action: 'event:create', mailboxId: form.get('mailboxId') || null, title: form.get('title'), description: form.get('description'), location: form.get('location'), attendees: values('attendees').split(',').map((value) => value.trim()).filter(Boolean), startsAt: new Date(values('startsAt')).toISOString(), endsAt: new Date(values('endsAt')).toISOString() }, event.currentTarget) }}>
          <Field label="Title" name="title" required />
          <Field label="Location" name="location" />
          <Field label="Starts" name="startsAt" type="datetime-local" required />
          <Field label="Ends" name="endsAt" type="datetime-local" required />
          <Field label="Attendees" name="attendees" placeholder="a@example.com, b@example.com" />
          <SelectField label="Mailbox" name="mailboxId" options={[['', '—'], ...mailboxes.map((mailbox) => [mailbox.id, mailbox.address] as [string, string])]} />
          <TextAreaField label="Description" name="description" className="sm:col-span-2" />
          <div className="flex justify-end sm:col-span-2"><Button><Plus /><Trans id="Add event" /></Button></div>
        </form>
      </AddCard>
    </>}

    {section === 'api-keys' && <>
      {data.apiKeys.length > 0 && <div className="grid gap-2">
        {data.apiKeys.map((key) => <Row key={key.id} icon={KeyRound} title={`${key.name} · ${key.prefix}…`} meta={(JSON.parse(key.scopes) as Array<string>).join(', ')} actions={<Delete onClick={() => remove('key', key.id)} />} />)}
      </div>}
      <AddCard title="Create key">
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'key:create', name: form.get('name'), scopes: form.getAll('scopes') }, event.currentTarget) }}>
          <Field label="Key name" name="name" required />
          <div className="flex flex-wrap gap-4"><CheckboxField label="messages:read" name="scopes" value="messages:read" /><CheckboxField label="messages:send" name="scopes" value="messages:send" /></div>
          <div className="flex justify-end"><Button><Plus /><Trans id="Create key" /></Button></div>
        </form>
      </AddCard>
    </>}

    {section === 'webhooks' && <>
      {data.webhooks.length > 0 && <div className="grid gap-2">
        {data.webhooks.map((hook) => <Row key={hook.id} icon={Webhook} title={hook.description || hook.url} meta={`${hook.url} · ${(JSON.parse(hook.events) as Array<string>).join(', ')}`} extra={data.deliveries.filter((delivery) => delivery.webhookId === hook.id).slice(0, 1).map((delivery) => <small key={delivery.id} className="mt-1 block text-muted-foreground">{delivery.eventType}: {delivery.status} ({delivery.attempts}) {delivery.error}</small>)} actions={<>
          <Button size="icon" variant="ghost" onClick={() => post({ action: 'webhook:test', id: hook.id })} aria-label={i18n._('Test')} title={i18n._('Test')}><Play /></Button>
          <Delete onClick={() => remove('webhook', hook.id)} />
        </>} />)}
      </div>}
      <AddCard title="Add webhook">
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'webhook:create', description: form.get('description'), url: form.get('url'), events: form.getAll('events'), maxAttempts: Number(form.get('maxAttempts')) }, event.currentTarget) }}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Description" name="description" />
            <Field label="HTTPS URL" name="url" type="url" required />
            <Field label="Maximum attempts" name="maxAttempts" type="number" min={1} max={10} defaultValue={5} required />
          </div>
          <div className="flex flex-wrap gap-4"><CheckboxField label="message.received" name="events" value="message.received" /><CheckboxField label="message.sent" name="events" value="message.sent" /></div>
          <div className="flex justify-end"><Button><Plus /><Trans id="Add webhook" /></Button></div>
        </form>
      </AddCard>
    </>}

    {section === 'import-export' && <>
      <Card className="rounded-2xl">
        <CardHeader className="flex-row items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Import className="size-5" /></span>
          <div><CardTitle className="text-xl"><Trans id="Mail import and export" /></CardTitle><CardDescription><Trans id="Import RFC 822 .eml or Unix .mbox files, or export accessible mailboxes as mbox." /></CardDescription></div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <SelectField label="Mailbox" name="transferMailboxId" className="min-w-48 flex-1" value={transferMailboxId || mailboxes[0]?.id || ''} onChange={(event) => setTransferMailboxId(event.target.value)} options={mailboxes.map((mailbox) => [mailbox.id, mailbox.address] as [string, string])} />
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border bg-background px-4 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-4">
            <Upload /><Trans id="Import EML or MBOX" />
            <input className="sr-only" type="file" accept=".eml,.mbox,.mbx,message/rfc822,application/mbox" multiple disabled={Boolean(importProgress)} onChange={(event) => { const files = [...(event.target.files ?? [])]; event.currentTarget.value = ''; void importFiles(files) }} />
          </label>
          <Button variant="outline" onClick={() => location.assign(`/api/export?mailboxId=${encodeURIComponent(transferMailboxId || mailboxes[0]?.id || '')}`)}><Download /><Trans id="Export MBOX" /></Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="flex-row items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Upload className="size-5" /></span>
          <div><CardTitle className="text-xl"><Trans id="IMAP import" /></CardTitle><CardDescription><Trans id="Copy messages from another account into your mailbox." /></CardDescription></div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-6" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch('/api/import/imap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mailboxId: form.get('mailboxId'), host: form.get('host'), port: Number(form.get('port')), username: form.get('username'), password: form.get('password'), folder: form.get('folder'), limit: Number(form.get('limit')) }) }); const result = await response.json<{ imported?: number; error?: string }>().catch(() => null); setStatus(response.ok ? { tone: 'success', text: `${i18n._('Import complete')}: ${result?.imported ?? 0}` } : { tone: 'error', text: result?.error || i18n._('Import failed') }); if (response.ok) event.currentTarget.reset() }}>
            <FieldGroup title="Connection" description="The IMAP server of the source account.">
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <Field label="IMAP host" name="host" icon={Server} placeholder="imap.example.com" required />
                <Field label="Port" name="port" type="number" min={1} max={65535} defaultValue={993} required />
              </div>
            </FieldGroup>
            <FieldGroup title="Sign in" description="Credentials of the source account.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Username" name="username" icon={User} autoComplete="username" required />
                <Field label="Password" name="password" icon={Lock} type="password" autoComplete="current-password" required />
              </div>
            </FieldGroup>
            <FieldGroup title="Destination" description="Where the imported messages go.">
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label="Mailbox" name="mailboxId" className="sm:col-span-2" options={mailboxes.map((mailbox) => [mailbox.id, mailbox.address] as [string, string])} />
                <Field label="Folder" name="folder" icon={FolderOpen} defaultValue="INBOX" required />
                <Field label="Message limit" name="limit" type="number" min={1} max={200} defaultValue={50} required />
              </div>
            </FieldGroup>
            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 shrink-0 text-emerald-500" /><Trans id="Credentials are used only for this import and are never stored." /></p>
              <Button className="sm:ml-auto"><Upload /><Trans id="Start import" /></Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>}
  </>
}

function ImportProgress({ current, total }: { current: number; total: number }) {
  const percent = total ? Math.round(current / total * 100) : 0
  return <div role="status" aria-live="polite" className="rounded-xl border border-primary/40 bg-primary/10 p-4 shadow-sm">
    <div className="flex items-center gap-3"><LoaderCircle className="size-5 animate-spin text-primary" /><strong>{total ? <><Trans id="Importing…" /> {current}/{total}</> : <Trans id="Preparing import…" />}</strong>{total > 0 && <span className="ml-auto font-mono text-sm text-primary">{percent}%</span>}</div>
    <div role="progressbar" aria-label="Import" aria-valuemin={0} aria-valuemax={100} aria-valuenow={total ? percent : undefined} className="mt-3 h-2 overflow-hidden rounded-full bg-primary/20">
      <div className={`h-full rounded-full bg-primary transition-[width] duration-300 ${total ? '' : 'w-1/3 animate-pulse'}`} style={total ? { width: `${percent}%` } : undefined} />
    </div>
  </div>
}

function FieldGroup({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-[13rem_1fr] md:gap-8">
    <div>
      <h3 className="text-sm font-semibold"><Trans id={title} /></h3>
      <p className="mt-0.5 text-xs text-muted-foreground"><Trans id={description} /></p>
    </div>
    <div className="min-w-0">{children}</div>
  </div>
}

function AddCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="rounded-2xl">
    <CardHeader className="flex-row items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Plus className="size-5" /></span>
      <CardTitle className="text-xl"><Trans id={title} /></CardTitle>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
}

function Row({ icon: Icon, title, meta, extra, badges, actions }: { icon: LucideIcon; title: string; meta?: string; extra?: React.ReactNode; badges?: React.ReactNode; actions?: React.ReactNode }) {
  return <div className="flex items-center gap-3 rounded-2xl border bg-card p-3.5 text-sm shadow-xs transition-shadow hover:shadow-md">
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon className="size-5" /></span>
    <div className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2"><strong className="truncate font-semibold">{title}</strong>{badges}</span>
      {meta && <small className="block truncate text-muted-foreground">{meta}</small>}
      {extra}
    </div>
    <div className="flex shrink-0 items-center gap-1">{actions}</div>
  </div>
}

function Delete({ onClick }: { onClick: () => void }) {
  const { i18n } = useLingui()
  return <Button type="button" size="icon" variant="ghost" className="text-muted-foreground hover:bg-red-500/10 hover:text-red-600" onClick={onClick} aria-label={i18n._('Delete')} title={i18n._('Delete')}><Trash2 /></Button>
}
