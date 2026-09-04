import { Trans, useLingui } from '@lingui/react'
import type { LucideIcon } from 'lucide-react'
import { Bell, Folder, KeyRound, Languages, ListFilter, Mail, Palette, Pencil, Plus, Save, SunMoon, Trash2, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LocaleToggle } from './locale-toggle'
import { PushToggle } from './push-toggle'
import type { Status } from './section-ui'
import { CheckboxField, Field, Loading, SectionHeader, SelectField, StatusBanner, TextAreaField } from './section-ui'
import { ThemeToggle } from './theme-toggle'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { authClient } from '@/lib/auth-client'

type Settings = {
  profile: { name: string; email: string; resetEmail: string | null; forwardingEmail: string | null; role: string }
  mailboxes: Array<{ id: string; displayName: string | null; localPart: string; hostname: string; signature: string | null; autoReplyEnabled: boolean; autoReplySubject: string; autoReplyBody: string }>
  folders: Array<{ id: string; mailboxId: string; name: string; color: string }>
  rules: Array<{ id: string; mailboxId: string | null; name: string | null; matchField: string; matchOperator: string; matchValue: string; action: string; folderId: string | null }>
}

type SettingsSection = 'profile' | 'appearance' | 'mailboxes' | 'folders' | 'rules'

const sectionDetails: Record<SettingsSection, { title: string; description: string; icon: LucideIcon }> = {
  profile: { title: 'Profile', description: 'Your name, recovery email and password.', icon: UserRound },
  appearance: { title: 'Appearance and notifications', description: 'Language, theme and push notification preferences.', icon: Palette },
  mailboxes: { title: 'Mailboxes', description: 'Signature and automatic replies per mailbox.', icon: Mail },
  folders: { title: 'Custom folders', description: 'Organize mail into your own folders.', icon: Folder },
  rules: { title: 'Inbox rules', description: 'Automatically sort incoming mail.', icon: ListFilter },
}

export function SettingsApp({ section }: { section: SettingsSection }) {
  const { i18n } = useLingui()
  const [data, setData] = useState<Settings | null>(null)
  const [status, setStatus] = useState<Status>(null)

  async function load() {
    const response = await fetch('/api/settings')
    if (response.ok) setData(await response.json<Settings>())
  }
  useEffect(() => { void load() }, [])

  async function update(body: unknown) {
    setStatus(null)
    const response = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json<{ error?: string }>().catch(() => null)
    setStatus(response.ok ? { tone: 'success', text: i18n._('Saved') } : { tone: 'error', text: result?.error || i18n._('Save failed') })
    if (response.ok) { setEditingFolder(null); setEditingRule(null); await load() }
  }

  const [editingFolder, setEditingFolder] = useState<Settings['folders'][number] | null>(null)
  const [editingRule, setEditingRule] = useState<Settings['rules'][number] | null>(null)

  async function remove(kind: 'folder' | 'rule', id: string) {
    const response = await fetch(`/api/settings?kind=${kind}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (response.ok) await load()
  }

  if (!data) return <Loading />

  const details = sectionDetails[section]
  return (
    <>
      <SectionHeader icon={details.icon} title={details.title} description={details.description} />
      <StatusBanner status={status} />

      {section === 'profile' && <>
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-xl"><Trans id="Profile" /></CardTitle><CardDescription>{data.profile.email}</CardDescription></CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update({ type: 'profile', name: form.get('name'), resetEmail: form.get('resetEmail'), forwardingEmail: form.get('forwardingEmail') }) }}>
              <Field label="Name" name="name" defaultValue={data.profile.name} required />
              <Field label="Recovery email" name="resetEmail" type="email" defaultValue={data.profile.resetEmail ?? data.profile.email} required />
              <Field label="Forward all mail to" name="forwardingEmail" type="email" defaultValue={data.profile.forwardingEmail ?? ''} />
              <div className="flex items-end justify-end"><Button><Save /><Trans id="Save" /></Button></div>
            </form>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="flex-row items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><KeyRound className="size-5" /></span>
            <div><CardTitle className="text-xl"><Trans id="Change password" /></CardTitle><CardDescription><Trans id="Use at least 12 characters." /></CardDescription></div>
          </CardHeader>
          <CardContent><PasswordForm /></CardContent>
        </Card>
      </>}

      {section === 'appearance' && <Card className="rounded-2xl">
        <CardContent className="grid gap-3 p-5">
          <Preference icon={Languages} label="Language"><LocaleToggle /></Preference>
          <Preference icon={SunMoon} label="Theme"><ThemeToggle /></Preference>
          <Preference icon={Bell} label="Push notifications"><PushToggle /></Preference>
        </CardContent>
      </Card>}

      {!['profile', 'appearance'].includes(section) && data.mailboxes.map((mailbox) => {
        const boxFolders = data.folders.filter((folder) => folder.mailboxId === mailbox.id)
        const boxRules = data.rules.filter((rule) => rule.mailboxId === mailbox.id)
        return (
          <Card key={mailbox.id} className="rounded-2xl">
            <CardHeader className="flex-row items-center gap-3 border-b pb-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Mail className="size-5" /></span>
              <div className="min-w-0"><CardTitle className="truncate text-lg">{mailbox.localPart}@{mailbox.hostname}</CardTitle><CardDescription><Trans id={section === 'mailboxes' ? 'Mailbox settings' : section === 'folders' ? 'Custom folders' : 'Inbox rules'} /></CardDescription></div>
            </CardHeader>
            <CardContent className="grid gap-6 pt-5">
              {section === 'mailboxes' && <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update({ type: 'mailbox', mailboxId: mailbox.id, displayName: form.get('displayName'), signature: form.get('signature'), autoReplyEnabled: form.get('autoReplyEnabled') === 'on', autoReplySubject: form.get('autoReplySubject'), autoReplyBody: form.get('autoReplyBody') }) }}>
                <Field label="Display name" name="displayName" defaultValue={mailbox.displayName ?? ''} />
                <TextAreaField label="Signature" name="signature" defaultValue={mailbox.signature ?? ''} />
                <div className="grid gap-4 rounded-xl border bg-muted/40 p-4">
                  <CheckboxField label="Automatic reply" name="autoReplyEnabled" defaultChecked={mailbox.autoReplyEnabled} />
                  <Field label="Automatic reply subject" name="autoReplySubject" defaultValue={mailbox.autoReplySubject} />
                  <TextAreaField label="Automatic reply message" name="autoReplyBody" defaultValue={mailbox.autoReplyBody} />
                </div>
                <div className="flex justify-end"><Button><Save /><Trans id="Save mailbox" /></Button></div>
              </form>}

              {section === 'folders' && <>
                {boxFolders.length > 0 && <div className="flex flex-wrap gap-2">
                  {boxFolders.map((folder) => <span key={folder.id} className="inline-flex items-center gap-2 rounded-full border bg-background py-1 pr-1.5 pl-3 text-sm font-medium shadow-xs">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: folder.color }} />{folder.name}
                    <button type="button" className="grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" onClick={() => setEditingFolder(folder)} aria-label={i18n._('Edit')} title={i18n._('Edit')}><Pencil className="size-3.5" /></button>
                    <button type="button" className="grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600" onClick={() => remove('folder', folder.id)} aria-label={i18n._('Delete')} title={i18n._('Delete')}><Trash2 className="size-3.5" /></button>
                  </span>)}
                </div>}
                {(() => { const editing = editingFolder?.mailboxId === mailbox.id ? editingFolder : null; return <form key={editing?.id ?? 'new'} className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update(editing ? { type: 'folder:update', mailboxId: mailbox.id, folderId: editing.id, name: form.get('name'), color: form.get('color') } : { type: 'folder', mailboxId: mailbox.id, name: form.get('name'), color: form.get('color') }); if (!editing) event.currentTarget.reset() }}>
                  <Field label="Folder name" name="name" defaultValue={editing?.name ?? ''} required className="min-w-40 flex-1" />
                  <label className="grid gap-2 text-sm font-medium"><Trans id="Color" /><input className="h-10 w-16 cursor-pointer rounded-md border bg-background p-1 shadow-xs" type="color" name="color" defaultValue={editing?.color ?? '#2563eb'} /></label>
                  {editing && <Button type="button" variant="outline" onClick={() => setEditingFolder(null)}><Trans id="Cancel" /></Button>}
                  <Button>{editing ? <Save /> : <Plus />}{editing ? <Trans id="Save folder" /> : <Trans id="Add folder" />}</Button>
                </form> })()}
              </>}

              {section === 'rules' && <>
                {boxRules.length > 0 && <div className="grid gap-2">
                  {boxRules.map((rule) => <div key={rule.id} className="flex items-center gap-3 rounded-xl border bg-background p-3 text-sm shadow-xs">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><ListFilter className="size-4" /></span>
                    <span className="min-w-0 flex-1"><strong className="font-medium">{rule.name}</strong><small className="block truncate text-muted-foreground">{rule.matchField} {rule.matchOperator} “{rule.matchValue}” → {rule.action}</small></span>
                    <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => setEditingRule(rule)} aria-label={i18n._('Edit')} title={i18n._('Edit')}><Pencil /></Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:bg-red-500/10 hover:text-red-600" onClick={() => remove('rule', rule.id)} aria-label={i18n._('Delete')} title={i18n._('Delete')}><Trash2 /></Button>
                  </div>)}
                </div>}
                {(() => { const editing = editingRule?.mailboxId === mailbox.id ? editingRule : null; return <form key={editing?.id ?? 'new'} className="grid gap-3 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const body = { mailboxId: mailbox.id, name: form.get('name'), matchField: form.get('matchField'), matchOperator: form.get('matchOperator'), matchValue: form.get('matchValue'), action: form.get('action'), folderId: form.get('folderId') || null }; void update(editing ? { type: 'rule:update', ruleId: editing.id, ...body } : { type: 'rule', ...body }); if (!editing) event.currentTarget.reset() }}>
                  <Field label="Rule name" name="name" defaultValue={editing?.name ?? ''} required />
                  <SelectField label="Match field" name="matchField" defaultValue={editing?.matchField} options={['sender', 'recipient', 'title', 'content']} />
                  <SelectField label="Operator" name="matchOperator" defaultValue={editing?.matchOperator} options={['contains', 'exact', 'starts_with', 'ends_with', 'regex']} />
                  <Field label="Value" name="matchValue" defaultValue={editing?.matchValue ?? ''} required />
                  <SelectField label="Action" name="action" defaultValue={editing?.action} options={['store', 'spam', 'trash']} />
                  <SelectField label="Destination folder" name="folderId" defaultValue={editing?.folderId ?? ''} options={[['', '—'], ...boxFolders.map((folder) => [folder.id, folder.name] as [string, string])]} />
                  <div className="flex justify-end gap-2 md:col-span-3">{editing && <Button type="button" variant="outline" onClick={() => setEditingRule(null)}><Trans id="Cancel" /></Button>}<Button>{editing ? <Save /> : <Plus />}{editing ? <Trans id="Save rule" /> : <Trans id="Add rule" />}</Button></div>
                </form> })()}
              </>}
            </CardContent>
          </Card>
        )
      })}
    </>
  )
}

function Preference({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return <div className="flex min-h-16 items-center gap-3 rounded-xl border bg-background px-4 py-2 shadow-xs">
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
    <span className="font-medium"><Trans id={label} /></span>
    <div className="ml-auto">{children}</div>
  </div>
}

function PasswordForm() {
  const { i18n } = useLingui()
  const [status, setStatus] = useState<Status>(null)
  return <form className="grid gap-4 md:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const result = await authClient.changePassword({ currentPassword: String(form.get('currentPassword')), newPassword: String(form.get('newPassword')), revokeOtherSessions: true }); setStatus(result.error ? { tone: 'error', text: i18n._('Password change failed') } : { tone: 'success', text: i18n._('Password changed') }); if (!result.error) event.currentTarget.reset() }}>
    <Field label="Current password" name="currentPassword" type="password" required minLength={12} autoComplete="current-password" />
    <Field label="New password" name="newPassword" type="password" required minLength={12} autoComplete="new-password" />
    {status && <div className="md:col-span-2"><StatusBanner status={status} /></div>}
    <div className="flex justify-end md:col-span-2"><Button><KeyRound /><Trans id="Change password" /></Button></div>
  </form>
}
