import { Trans, useLingui } from '@lingui/react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Download, KeyRound, LoaderCircle, Play, Plus, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
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
type BackupData = { settings: { enabled: boolean; scheduleType: string; scheduleValue: number | null; retentionEnabled: boolean; retentionDays: number } | null; backups: Array<{ id: string; status: string; filename: string | null; size: number | null; createdAt: string }> }

export function ToolsApp({ admin }: { admin: boolean }) {
  const { i18n } = useLingui()
  const [data, setData] = useState<ToolData | null>(null)
  const [mailboxes, setMailboxes] = useState<Array<Mailbox>>([])
  const [transferMailboxId, setTransferMailboxId] = useState('')
  const [backups, setBackups] = useState<BackupData | null>(null)
  const [status, setStatus] = useState('')

  async function load() {
    const [tools, boxes, backupResponse] = await Promise.all([fetch('/api/tools'), fetch('/api/mailboxes'), admin ? fetch('/api/backups') : null])
    if (tools.ok) setData(await tools.json<ToolData>())
    if (boxes.ok) setMailboxes(await boxes.json<Array<Mailbox>>())
    if (backupResponse?.ok) setBackups(await backupResponse.json<BackupData>())
  }
  useEffect(() => { void load() }, [])

  async function post(body: unknown, form?: HTMLFormElement) {
    setStatus('')
    const response = await fetch('/api/tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json<{ key?: string; error?: string }>().catch(() => null)
    setStatus(result?.key ? `${i18n._('Copy this key now')}: ${result.key}` : response.ok ? i18n._('Saved') : result?.error || i18n._('Save failed'))
    if (response.ok) { form?.reset(); await load() }
  }
  async function remove(kind: string, id: string) {
    if ((await fetch(`/api/tools?kind=${kind}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })).ok) await load()
  }
  async function importFiles(files: File[]) {
    const mailboxId = transferMailboxId || mailboxes[0]?.id
    if (!mailboxId || !files.length) return
    try {
      const batches = await createImportBatches(files)
      let imported = 0
      let skipped = 0
      const errors: string[] = []
      for (const [index, batch] of batches.entries()) {
        setStatus(`${i18n._('Importing…')} ${index + 1}/${batches.length}`)
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
      setStatus(`${i18n._('Import complete')}: ${imported} · ${i18n._('Skipped')}: ${skipped}${errors.length ? ` · ${errors.slice(0, 3).join(' · ')}` : ''}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : i18n._('Import failed'))
    }
  }
  if (!data) return <div className="grid h-dvh place-items-center"><LoaderCircle className="animate-spin" /></div>

  return <main className="min-h-dvh bg-muted p-3 md:p-8"><div className="mx-auto max-w-6xl space-y-5">
    <header className="flex items-center gap-2"><Button asChild variant="ghost" size="icon"><Link to="/inbox" aria-label={i18n._('Back to inbox')}><ArrowLeft /></Link></Button><h1 className="text-2xl font-semibold"><Trans id="Tools" /></h1></header>
    {status && <p role="status" className="break-all rounded-md bg-background p-3 text-sm">{status}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <Card><CardHeader><CardTitle><Trans id="Contacts and blocklist" /></CardTitle></CardHeader><CardContent className="grid gap-4"><Rows>{data.contacts.map((contact) => <Row key={contact.id}><span><strong>{contact.displayName}</strong> {contact.email} {contact.blocked && <em className="text-red-600"><Trans id="blocked" /></em>}</span><Button size="sm" variant="outline" onClick={() => post({ action: 'contact:block', id: contact.id, blocked: !contact.blocked })}>{contact.blocked ? <Trans id="Unblock" /> : <Trans id="Block" />}</Button><Delete onClick={() => remove('contact', contact.id)} /></Row>)}</Rows><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'contact:create', email: form.get('email'), displayName: form.get('displayName'), blocked: false }, event.currentTarget) }}><Field label="Display name" name="displayName" /><Field label="Email" name="email" type="email" required /><Button className="w-fit"><Plus /><Trans id="Add contact" /></Button></form></CardContent></Card>

      <Card><CardHeader><CardTitle><Trans id="Templates" /></CardTitle></CardHeader><CardContent className="grid gap-4"><Rows>{data.templates.map((template) => <Row key={template.id}><span><strong>{template.name}</strong><small className="block text-muted-foreground">{template.subject}</small></span><Delete onClick={() => remove('template', template.id)} /></Row>)}</Rows><form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'template:create', name: form.get('name'), subject: form.get('subject'), textBody: form.get('textBody') }, event.currentTarget) }}><Field label="Template name" name="name" required /><Field label="Subject" name="subject" /><TextArea label="Message" name="textBody" /><Button className="w-fit"><Plus /><Trans id="Add template" /></Button></form></CardContent></Card>

      <Card><CardHeader><CardTitle><Trans id="Calendar" /></CardTitle></CardHeader><CardContent className="grid gap-4"><Rows>{data.events.map((event) => <Row key={event.id}><span><strong>{event.title}</strong><small className="block text-muted-foreground">{new Date(event.startsAt).toLocaleString(i18n.locale)} · {event.location}</small></span><Delete onClick={() => remove('event', event.id)} /></Row>)}</Rows><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const values = (name: string) => String(form.get(name)); void post({ action: 'event:create', mailboxId: form.get('mailboxId') || null, title: form.get('title'), description: form.get('description'), location: form.get('location'), attendees: values('attendees').split(',').map((value) => value.trim()).filter(Boolean), startsAt: new Date(values('startsAt')).toISOString(), endsAt: new Date(values('endsAt')).toISOString() }, event.currentTarget) }}><Field label="Title" name="title" required /><Field label="Location" name="location" /><Field label="Starts" name="startsAt" type="datetime-local" required /><Field label="Ends" name="endsAt" type="datetime-local" required /><Field label="Attendees" name="attendees" placeholder="a@example.com, b@example.com" /><label className="grid gap-2 text-sm font-medium"><Trans id="Mailbox" /><select className="h-10 rounded-md border bg-background px-3" name="mailboxId"><option value="">—</option>{mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.address}</option>)}</select></label><TextArea label="Description" name="description" /><Button className="w-fit"><Plus /><Trans id="Add event" /></Button></form></CardContent></Card>

      <Card><CardHeader><CardTitle><Trans id="API keys" /></CardTitle><CardDescription><Trans id="Use Bearer keys with the QiberMail v1 API." /></CardDescription></CardHeader><CardContent className="grid gap-4"><Rows>{data.apiKeys.map((key) => <Row key={key.id}><span><KeyRound className="mr-2 inline size-4" /><strong>{key.name}</strong> · {key.prefix}…<small className="block text-muted-foreground">{(JSON.parse(key.scopes) as Array<string>).join(', ')}</small></span><Delete onClick={() => remove('key', key.id)} /></Row>)}</Rows><form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'key:create', name: form.get('name'), scopes: form.getAll('scopes') }, event.currentTarget) }}><Field label="Key name" name="name" required /><label className="flex gap-4 text-sm"><span><input type="checkbox" name="scopes" value="messages:read" /> messages:read</span><span><input type="checkbox" name="scopes" value="messages:send" /> messages:send</span></label><Button className="w-fit"><Plus /><Trans id="Create key" /></Button></form></CardContent></Card>
    </div>

    <Card><CardHeader><CardTitle><Trans id="Webhooks" /></CardTitle><CardDescription><Trans id="Signed delivery for received and sent messages." /></CardDescription></CardHeader><CardContent className="grid gap-5"><Rows>{data.webhooks.map((hook) => <Row key={hook.id}><span><strong>{hook.description || hook.url}</strong><small className="block text-muted-foreground">{hook.url} · {(JSON.parse(hook.events) as Array<string>).join(', ')}</small>{data.deliveries.filter((delivery) => delivery.webhookId === hook.id).slice(0, 1).map((delivery) => <small key={delivery.id} className="block">{delivery.eventType}: {delivery.status} ({delivery.attempts}) {delivery.error}</small>)}</span><Button size="icon" variant="ghost" onClick={() => post({ action: 'webhook:test', id: hook.id })} aria-label={i18n._('Test')}><Play /></Button><Delete onClick={() => remove('webhook', hook.id)} /></Row>)}</Rows><form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: 'webhook:create', description: form.get('description'), url: form.get('url'), events: form.getAll('events'), maxAttempts: Number(form.get('maxAttempts')) }, event.currentTarget) }}><Field label="Description" name="description" /><Field label="HTTPS URL" name="url" type="url" required /><Field label="Maximum attempts" name="maxAttempts" type="number" min={1} max={10} defaultValue={5} required /><label className="flex gap-4 text-sm"><span><input type="checkbox" name="events" value="message.received" /> message.received</span><span><input type="checkbox" name="events" value="message.sent" /> message.sent</span></label><Button className="w-fit"><Plus /><Trans id="Add webhook" /></Button></form></CardContent></Card>

    <Card><CardHeader><CardTitle><Trans id="Mail import and export" /></CardTitle><CardDescription><Trans id="Import RFC 822 .eml or Unix .mbox files, or export accessible mailboxes as mbox." /></CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><label className="grid gap-2 text-sm"><Trans id="Mailbox" /><select value={transferMailboxId || mailboxes[0]?.id || ''} onChange={(event) => setTransferMailboxId(event.target.value)} className="h-10 rounded-md border bg-background px-3">{mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.address}</option>)}</select></label><label className="mt-auto inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm"><Upload /><Trans id="Import EML or MBOX" /><input className="sr-only" type="file" accept=".eml,.mbox,.mbx,message/rfc822,application/mbox" multiple onChange={(event) => { const files = [...(event.target.files ?? [])]; event.currentTarget.value = ''; void importFiles(files) }} /></label><Button className="mt-auto" variant="outline" onClick={() => location.assign(`/api/export?mailboxId=${encodeURIComponent(transferMailboxId || mailboxes[0]?.id || '')}`)}><Download /><Trans id="Export MBOX" /></Button></CardContent></Card>

    <Card><CardHeader><CardTitle><Trans id="IMAP import" /></CardTitle><CardDescription><Trans id="Credentials are used only for this import and are never stored." /></CardDescription></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-3" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch('/api/import/imap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mailboxId: form.get('mailboxId'), host: form.get('host'), port: Number(form.get('port')), username: form.get('username'), password: form.get('password'), folder: form.get('folder'), limit: Number(form.get('limit')) }) }); const result = await response.json<{ imported?: number; error?: string }>().catch(() => null); setStatus(response.ok ? `${i18n._('Import complete')}: ${result?.imported ?? 0}` : result?.error || i18n._('Import failed')); if (response.ok) event.currentTarget.reset() }}><label className="grid gap-2 text-sm font-medium"><Trans id="Mailbox" /><select className="h-10 rounded-md border bg-background px-3" name="mailboxId">{mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.address}</option>)}</select></label><Field label="IMAP host" name="host" placeholder="imap.example.com" required /><Field label="Port" name="port" type="number" min={1} max={65535} defaultValue={993} required /><Field label="Username" name="username" autoComplete="username" required /><Field label="Password" name="password" type="password" autoComplete="current-password" required /><Field label="Folder" name="folder" defaultValue="INBOX" required /><Field label="Message limit" name="limit" type="number" min={1} max={200} defaultValue={50} required /><Button className="w-fit"><Upload /><Trans id="Start import" /></Button></form></CardContent></Card>

    {admin && backups && <BackupCard data={backups} reload={load} />}
  </div></main>
}

function BackupCard({ data, reload }: { data: BackupData; reload: () => Promise<void> }) {
  return <Card><CardHeader><CardTitle><Trans id="Backup and restore" /></CardTitle><CardDescription><Trans id="D1 backups are encrypted in transit and stored in the configured private R2 bucket." /></CardDescription></CardHeader><CardContent className="grid gap-5"><Rows>{data.backups.map((backup) => <Row key={backup.id}><span>{backup.filename ?? backup.id}<small className="block text-muted-foreground">{backup.status} · {new Date(backup.createdAt).toLocaleString()}</small></span>{backup.status === 'completed' && <Button asChild variant="outline" size="sm"><a href={`/api/backups/${backup.id}`}><Download /><Trans id="Download" /></a></Button>}</Row>)}</Rows><div className="flex flex-wrap gap-2"><Button onClick={async () => { await fetch('/api/backups', { method: 'POST' }); await reload() }}><Plus /><Trans id="Create backup" /></Button><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"><Upload /><Trans id="Restore backup" /><input className="sr-only" type="file" accept="application/json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file || !confirm('Restore this backup? Current data will be replaced.')) return; const response = await fetch('/api/backups', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: file }); if (response.ok) location.assign('/login') }} /></label></div><form className="grid gap-3 sm:grid-cols-3" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); await fetch('/api/backups', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: form.get('enabled') === 'on', scheduleType: form.get('scheduleType'), scheduleValue: form.get('scheduleValue') ? Number(form.get('scheduleValue')) : null, retentionEnabled: form.get('retentionEnabled') === 'on', retentionDays: Number(form.get('retentionDays')) }) }); await reload() }}><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={data.settings?.enabled} /><Trans id="Scheduled backups" /></label><label className="grid gap-2 text-sm"><Trans id="Schedule" /><select name="scheduleType" defaultValue={data.settings?.scheduleType ?? 'daily'} className="h-10 rounded-md border bg-background px-3"><option value="daily">daily</option><option value="weekly">weekly</option><option value="monthly">monthly</option></select></label><Field label="Day value" name="scheduleValue" type="number" min={0} max={31} defaultValue={data.settings?.scheduleValue ?? ''} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="retentionEnabled" defaultChecked={data.settings?.retentionEnabled} /><Trans id="Delete expired backups" /></label><Field label="Retention days" name="retentionDays" type="number" min={1} max={3650} defaultValue={data.settings?.retentionDays ?? 30} /><Button className="w-fit"><Trans id="Save" /></Button></form></CardContent></Card>
}

function Rows({ children }: { children: React.ReactNode }) { return <div className="grid gap-2">{children}</div> }
function Row({ children }: { children: React.ReactNode }) { return <div className="flex items-center gap-2 rounded-md border p-3 text-sm [&>:first-child]:min-w-0 [&>:first-child]:flex-1">{children}</div> }
function Delete({ onClick }: { onClick: () => void }) { return <Button type="button" size="icon" variant="ghost" onClick={onClick} aria-label="Delete"><Trash2 /></Button> }
function Field({ label, ...props }: React.ComponentProps<typeof Input> & { label: string }) { return <label className="grid gap-2 text-sm font-medium"><Trans id={label} /><Input {...props} /></label> }
function TextArea({ label, name }: { label: string; name: string }) { return <label className="grid gap-2 text-sm font-medium sm:col-span-2"><Trans id={label} /><textarea className="min-h-20 rounded-md border bg-background p-3" name={name} /></label> }
