import { Trans, useLingui } from '@lingui/react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LocaleToggle } from './locale-toggle'
import { ThemeToggle } from './theme-toggle'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { authClient } from '@/lib/auth-client'

type Settings = {
  profile: { name: string; email: string; resetEmail: string | null; forwardingEmail: string | null; role: string }
  mailboxes: Array<{ id: string; displayName: string | null; localPart: string; hostname: string; signature: string | null; autoReplyEnabled: boolean; autoReplySubject: string; autoReplyBody: string }>
  folders: Array<{ id: string; mailboxId: string; name: string; color: string }>
  rules: Array<{ id: string; mailboxId: string | null; name: string | null; matchField: string; matchOperator: string; matchValue: string; action: string; folderId: string | null }>
}

export function SettingsApp() {
  const { i18n } = useLingui()
  const [data, setData] = useState<Settings | null>(null)
  const [message, setMessage] = useState('')

  async function load() {
    const response = await fetch('/api/settings')
    if (response.ok) setData(await response.json<Settings>())
  }
  useEffect(() => { void load() }, [])

  async function update(body: unknown) {
    setMessage('')
    const response = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setMessage(response.ok ? i18n._('Saved') : i18n._('Save failed'))
    if (response.ok) await load()
  }

  async function remove(kind: 'folder' | 'rule', id: string) {
    const response = await fetch(`/api/settings?kind=${kind}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (response.ok) await load()
  }

  if (!data) return <div className="grid h-dvh place-items-center"><LoaderCircle className="animate-spin" /></div>
  return (
    <main className="min-h-dvh bg-muted p-3 md:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon"><Link to="/inbox" aria-label={i18n._('Back to inbox')}><ArrowLeft /></Link></Button>
          <h1 className="text-2xl font-semibold"><Trans id="Settings" /></h1>
          <div className="ml-auto flex gap-2"><LocaleToggle /><ThemeToggle /></div>
        </header>
        {message && <p role="status" className="rounded-md bg-background p-3 text-sm">{message}</p>}

        <Card>
          <CardHeader><CardTitle><Trans id="Profile" /></CardTitle><CardDescription>{data.profile.email}</CardDescription></CardHeader>
          <CardContent className="grid gap-6">
            <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update({ type: 'profile', name: form.get('name'), resetEmail: form.get('resetEmail'), forwardingEmail: form.get('forwardingEmail') }) }}>
              <Field label="Name" name="name" defaultValue={data.profile.name} required />
              <Field label="Recovery email" name="resetEmail" type="email" defaultValue={data.profile.resetEmail ?? data.profile.email} required />
              <Field label="Forward all mail to" name="forwardingEmail" type="email" defaultValue={data.profile.forwardingEmail ?? ''} />
              <Button className="self-end"><Save /><Trans id="Save" /></Button>
            </form>
            <PasswordForm />
          </CardContent>
        </Card>

        {data.mailboxes.map((mailbox) => {
          const boxFolders = data.folders.filter((folder) => folder.mailboxId === mailbox.id)
          const boxRules = data.rules.filter((rule) => rule.mailboxId === mailbox.id)
          return (
            <Card key={mailbox.id}>
              <CardHeader><CardTitle>{mailbox.localPart}@{mailbox.hostname}</CardTitle><CardDescription><Trans id="Mailbox settings" /></CardDescription></CardHeader>
              <CardContent className="grid gap-8">
                <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update({ type: 'mailbox', mailboxId: mailbox.id, displayName: form.get('displayName'), signature: form.get('signature'), autoReplyEnabled: form.get('autoReplyEnabled') === 'on', autoReplySubject: form.get('autoReplySubject'), autoReplyBody: form.get('autoReplyBody') }) }}>
                  <Field label="Display name" name="displayName" defaultValue={mailbox.displayName ?? ''} />
                  <TextArea label="Signature" name="signature" defaultValue={mailbox.signature ?? ''} />
                  <label className="flex items-center gap-2 text-sm font-medium"><input name="autoReplyEnabled" type="checkbox" defaultChecked={mailbox.autoReplyEnabled} /><Trans id="Automatic reply" /></label>
                  <Field label="Automatic reply subject" name="autoReplySubject" defaultValue={mailbox.autoReplySubject} />
                  <TextArea label="Automatic reply message" name="autoReplyBody" defaultValue={mailbox.autoReplyBody} />
                  <Button className="w-fit"><Save /><Trans id="Save mailbox" /></Button>
                </form>

                <section className="grid gap-3"><h3 className="font-semibold"><Trans id="Custom folders" /></h3>
                  <div className="flex flex-wrap gap-2">{boxFolders.map((folder) => <span key={folder.id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"><span className="size-2 rounded-full" style={{ backgroundColor: folder.color }} />{folder.name}<button type="button" onClick={() => remove('folder', folder.id)} aria-label={i18n._('Delete')}><Trash2 className="size-3" /></button></span>)}</div>
                  <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update({ type: 'folder', mailboxId: mailbox.id, name: form.get('name'), color: form.get('color') }); event.currentTarget.reset() }}>
                    <Field label="Folder name" name="name" required /><label className="grid gap-2 text-sm font-medium"><Trans id="Color" /><input className="h-10 w-16 rounded-md border" type="color" name="color" defaultValue="#2563eb" /></label><Button><Plus /><Trans id="Add folder" /></Button>
                  </form>
                </section>

                <section className="grid gap-3"><h3 className="font-semibold"><Trans id="Inbox rules" /></h3>
                  <div className="grid gap-2">{boxRules.map((rule) => <div key={rule.id} className="flex items-center rounded-md border p-3 text-sm"><span>{rule.name}: {rule.matchField} {rule.matchOperator} “{rule.matchValue}” → {rule.action}</span><Button className="ml-auto" variant="ghost" size="icon" onClick={() => remove('rule', rule.id)} aria-label={i18n._('Delete')}><Trash2 /></Button></div>)}</div>
                  <form className="grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update({ type: 'rule', mailboxId: mailbox.id, name: form.get('name'), matchField: form.get('matchField'), matchOperator: form.get('matchOperator'), matchValue: form.get('matchValue'), action: form.get('action'), folderId: form.get('folderId') || null }); event.currentTarget.reset() }}>
                    <Field label="Rule name" name="name" required />
                    <Select label="Match field" name="matchField" options={['sender', 'recipient', 'title', 'content']} />
                    <Select label="Operator" name="matchOperator" options={['contains', 'exact', 'starts_with', 'ends_with', 'regex']} />
                    <Field label="Value" name="matchValue" required />
                    <Select label="Action" name="action" options={['store', 'spam', 'trash']} />
                    <label className="grid gap-2 text-sm font-medium"><Trans id="Destination folder" /><select name="folderId" className="h-10 rounded-md border bg-background px-3"><option value="">—</option>{boxFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
                    <Button className="w-fit"><Plus /><Trans id="Add rule" /></Button>
                  </form>
                </section>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </main>
  )
}

function PasswordForm() {
  const { i18n } = useLingui()
  const [status, setStatus] = useState('')
  return <form className="grid gap-4 border-t pt-5 md:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await authClient.changePassword({ currentPassword: String(form.get('currentPassword')), newPassword: String(form.get('newPassword')), revokeOtherSessions: true }); setStatus(result.error ? i18n._('Password change failed') : i18n._('Password changed')); if (!result.error) event.currentTarget.reset() }}>
    <Field label="Current password" name="currentPassword" type="password" required minLength={12} /><Field label="New password" name="newPassword" type="password" required minLength={12} /><Button className="w-fit"><Trans id="Change password" /></Button>{status && <p role="status" className="self-center text-sm">{status}</p>}
  </form>
}

function Field({ label, ...props }: React.ComponentProps<typeof Input> & { label: string }) {
  const id = `${String(props.name)}-${label}`
  return <label htmlFor={id} className="grid gap-2 text-sm font-medium"><Trans id={label} /><Input id={id} {...props} /></label>
}

function TextArea({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) {
  return <label className="grid gap-2 text-sm font-medium"><Trans id={label} /><textarea name={name} defaultValue={defaultValue} className="min-h-24 rounded-md border bg-background p-3 text-sm" /></label>
}

function Select({ label, name, options }: { label: string; name: string; options: Array<string> }) {
  return <label className="grid gap-2 text-sm font-medium"><Trans id={label} /><select name={name} className="h-10 rounded-md border bg-background px-3">{options.map((option) => <option key={option}>{option}</option>)}</select></label>
}
