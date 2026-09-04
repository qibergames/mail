import { Trans, useLingui } from '@lingui/react'
import { AlertCircle, CheckCircle2, Clock3, DatabaseBackup, Download, LoaderCircle, Play, RefreshCw, Save, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'

type Backup = { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; trigger: 'manual' | 'scheduled'; filename: string | null; size: number | null; error: string | null; createdAt: string }
type BackupData = { settings: { enabled: boolean; scheduleType: 'daily' | 'weekly' | 'monthly'; scheduleValue: number | null; retentionEnabled: boolean; retentionDays: number } | null; backups: Array<Backup> }

export function BackupApp() {
  const { i18n } = useLingui()
  const restoreInput = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<BackupData | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState('')

  async function load() {
    const response = await fetch('/api/backups')
    const result = await response.json<BackupData & { error?: string }>().catch(() => null)
    if (!response.ok || !result) return setError(result?.error || i18n._('Failed to load backups'))
    setData(result)
    setError('')
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!data?.backups.some((backup) => backup.status === 'queued' || backup.status === 'running')) return
    const timer = setTimeout(() => void load(), 3000)
    return () => clearTimeout(timer)
  }, [data])

  async function createBackup() {
    setBusy('create'); setError(''); setStatus('')
    const response = await fetch('/api/backups', { method: 'POST' })
    const result = await response.json<{ error?: string }>().catch(() => null)
    setBusy('')
    if (!response.ok) return setError(result?.error || i18n._('Backup failed'))
    setStatus(i18n._('Backup started'))
    await load()
  }

  async function restore(file: File) {
    setBusy('restore'); setError(''); setStatus('')
    const response = await fetch('/api/backups', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: file })
    const result = await response.json<{ error?: string }>().catch(() => null)
    setBusy('')
    if (!response.ok) return setError(result?.error || i18n._('Restore failed'))
    location.assign('/login')
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('settings'); setError(''); setStatus('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/backups', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: form.get('enabled') === 'on', scheduleType: form.get('scheduleType'), scheduleValue: form.get('scheduleValue') ? Number(form.get('scheduleValue')) : null, retentionEnabled: form.get('retentionEnabled') === 'on', retentionDays: Number(form.get('retentionDays')) }) })
    const result = await response.json<{ error?: string }>().catch(() => null)
    setBusy('')
    if (!response.ok) return setError(result?.error || i18n._('Save failed'))
    setStatus(i18n._('Saved'))
    await load()
  }

  if (!data && !error) return <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin" /></div>

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><DatabaseBackup /></span>
      <div><h2 className="text-2xl font-semibold"><Trans id="Backup and restore" /></h2><p className="text-sm text-muted-foreground"><Trans id="D1 backups are encrypted in transit and stored in the configured private R2 bucket." /></p></div>
      <div className="flex gap-2 sm:ml-auto">
        <input ref={restoreInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file && confirm(i18n._('Restore this backup? Current data will be replaced.'))) void restore(file) }} />
        <Button variant="outline" disabled={Boolean(busy)} onClick={() => restoreInput.current?.click()}>{busy === 'restore' ? <LoaderCircle className="animate-spin" /> : <Upload />}<Trans id="Restore backup" /></Button>
        <Button disabled={Boolean(busy)} onClick={createBackup}>{busy === 'create' ? <LoaderCircle className="animate-spin" /> : <Play />}<Trans id="Create backup" /></Button>
      </div>
    </div>

    {error && <p role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600"><AlertCircle className="size-4 shrink-0" />{error}</p>}
    {status && <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600"><CheckCircle2 className="size-4 shrink-0" />{status}</p>}

    {data && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="overflow-hidden rounded-2xl">
        <CardHeader className="flex-row items-center border-b"><div><CardTitle className="text-xl"><Trans id="Backup history" /></CardTitle><CardDescription><Trans id="Completed backups can be downloaded as JSON." /></CardDescription></div><Button className="ml-auto" size="icon" variant="ghost" onClick={load} aria-label={i18n._('Refresh')}><RefreshCw /></Button></CardHeader>
        <CardContent className="grid gap-3 p-4">
          {data.backups.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground"><Trans id="No backups yet." /></p>}
          {data.backups.map((backup) => <article key={backup.id} className="flex flex-col gap-3 rounded-xl border bg-background p-4 sm:flex-row sm:items-center">
            <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', backup.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600' : backup.status === 'failed' ? 'bg-red-500/10 text-red-600' : 'bg-primary/10 text-primary')}>{backup.status === 'completed' ? <CheckCircle2 /> : backup.status === 'failed' ? <AlertCircle /> : <Clock3 className={backup.status === 'running' ? 'animate-pulse' : ''} />}</span>
            <div className="min-w-0 flex-1"><h3 className="truncate font-medium">{backup.filename ?? backup.id}</h3><p className="text-xs text-muted-foreground">{backup.trigger} · {new Date(backup.createdAt).toLocaleString(i18n.locale)}{backup.size !== null && ` · ${(backup.size / 1024).toFixed(1)} KB`}</p>{backup.error && <p className="mt-1 break-words text-xs text-red-600">{backup.error}</p>}</div>
            <span className={cn('w-fit rounded-full border px-2.5 py-1 text-xs font-medium', backup.status === 'completed' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600', backup.status === 'failed' && 'border-red-500/30 bg-red-500/10 text-red-600', (backup.status === 'queued' || backup.status === 'running') && 'border-primary/30 bg-primary/10 text-primary')}><Trans id={backup.status} /></span>
            {backup.status === 'completed' && <Button asChild variant="outline" size="sm"><a href={`/api/backups/${backup.id}`}><Download /><Trans id="Download" /></a></Button>}
          </article>)}
        </CardContent>
      </Card>

      <Card className="h-fit rounded-2xl"><CardHeader><CardTitle className="text-xl"><Trans id="Backup settings" /></CardTitle><CardDescription><Trans id="Automatic backups run at 02:00 UTC." /></CardDescription></CardHeader><CardContent><form className="grid gap-4" onSubmit={saveSettings}>
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={data.settings?.enabled} /><Trans id="Scheduled backups" /></label>
        <label className="grid gap-2 text-sm font-medium"><Trans id="Schedule" /><select name="scheduleType" defaultValue={data.settings?.scheduleType ?? 'daily'} className="h-10 rounded-md border bg-background px-3"><option value="daily">daily</option><option value="weekly">weekly</option><option value="monthly">monthly</option></select></label>
        <label className="grid gap-2 text-sm font-medium"><Trans id="Day value" /><Input name="scheduleValue" type="number" min={0} max={31} defaultValue={data.settings?.scheduleValue ?? ''} /></label>
        <div className="border-t pt-4"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="retentionEnabled" defaultChecked={data.settings?.retentionEnabled} /><Trans id="Delete expired backups" /></label></div>
        <label className="grid gap-2 text-sm font-medium"><Trans id="Retention days" /><Input name="retentionDays" type="number" min={1} max={3650} defaultValue={data.settings?.retentionDays ?? 30} /></label>
        <Button disabled={Boolean(busy)}>{busy === 'settings' ? <LoaderCircle className="animate-spin" /> : <Save />}<Trans id="Save" /></Button>
      </form></CardContent></Card>
    </div>}
  </div>
}
