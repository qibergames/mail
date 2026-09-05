import { Trans, useLingui } from '@lingui/react'
import { CalendarClock, ChevronDown, FileText, LoaderCircle, Maximize2, Minimize2, Minus, Paperclip, Send, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { mailStore } from '@/lib/mail-store'
import { cn } from '@/lib/utils'

export type Draft = { id?: string; to?: string; subject?: string; text?: string }
type ComposerMailbox = { id: string; address: string; name: string | null }
type Template = { id: string; name: string; subject: string; textBody: string }

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

async function encodeFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { filename: file.name, type: file.type || 'application/octet-stream', content: btoa(binary) }
}

export function Composer({ mailboxes, mailboxId, draft, close, sent }: { mailboxes: Array<ComposerMailbox>; mailboxId: string; draft: Draft; close: () => void; sent: () => void }) {
  const { i18n } = useLingui()
  const [from, setFrom] = useState(mailboxId)
  const [to, setTo] = useState(draft.to ?? '')
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [text, setText] = useState(draft.text ?? '')
  const [files, setFiles] = useState<Array<File>>([])
  const [scheduledAt, setScheduledAt] = useState('')
  const [layout, setLayout] = useState<'docked' | 'minimized' | 'expanded'>('docked')
  const [menu, setMenu] = useState<'schedule' | 'templates' | null>(null)
  const [templates, setTemplates] = useState<Array<Template>>([])
  const [sending, setSending] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState('')
  const draftId = useRef(draft.id)
  const dirty = useRef(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void fetch('/api/tools').then((response) => response.json<{ templates: Array<Template> }>()).then((data) => setTemplates(data.templates)).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (draft.to) bodyRef.current?.focus()
  }, [draft.to])

  async function saveDraft(values: { to: string; subject: string; text: string; mailboxId: string }) {
    setSaveState('saving')
    const response = await fetch('/api/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: draftId.current, ...values }) })
    if (response.ok) { draftId.current = (await response.json<{ id: string }>()).id; setSaveState('saved'); void mailStore.sync() } else setSaveState('idle')
  }

  useEffect(() => {
    if (!dirty.current) return
    const timer = setTimeout(() => { void saveDraft({ to, subject, text, mailboxId: from }) }, 800)
    return () => clearTimeout(timer)
  }, [to, subject, text, from])

  function edit<T>(setter: (value: T) => void) {
    return (value: T) => { dirty.current = true; setter(value) }
  }

  async function discard() {
    if (draftId.current) await fetch(`/api/drafts?id=${encodeURIComponent(draftId.current)}`, { method: 'DELETE' }).catch(() => undefined)
    void mailStore.sync()
    close()
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault()
    if (!to || !text || sending) return
    setSending(true)
    setError('')
    setMenu(null)
    const attachments = await Promise.all(files.map(encodeFile))
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailboxId: from, draftId: draftId.current, to, subject, text, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined, attachments }),
    })
    setSending(false)
    if (!response.ok) {
      const result = await response.json<{ error?: string }>().catch(() => null)
      return setError(result?.error ?? i18n._('Send failed'))
    }
    sent()
  }

  const mailbox = mailboxes.find((item) => item.id === from)
  const title = subject || i18n._('New message')
  const minimized = layout === 'minimized'
  const expanded = layout === 'expanded'
  const iconButton = 'size-7 rounded-md text-white/80 hover:bg-white/15 hover:text-white'

  return <>
    {expanded && <button type="button" aria-label={i18n._('Exit full screen')} className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={() => setLayout('docked')} />}
    <form
      onSubmit={submit}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close() } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit() }}
      role="dialog"
      aria-modal={expanded}
      aria-labelledby="composer-title"
      className={cn(
        'fixed z-50 flex flex-col overflow-hidden bg-background shadow-2xl ring-1 ring-black/10 dark:ring-white/10',
        // Positioning per state. Responsive utilities override plain ones, so every state sets its own sm: offsets.
        expanded ? 'inset-0 sm:inset-4 sm:mx-auto sm:max-w-5xl sm:rounded-xl' : 'sm:inset-auto sm:right-6 sm:bottom-0 sm:rounded-t-xl',
        !expanded && !minimized && 'inset-0 sm:h-[min(38rem,calc(100dvh-1rem))] sm:w-[34rem]',
        minimized && 'right-4 bottom-0 h-11 w-64 rounded-t-xl sm:w-72',
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-1 bg-zinc-800 px-3 text-white dark:bg-zinc-900">
        <button type="button" id="composer-title" className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => minimized && setLayout('docked')}>{title}</button>
        <Button type="button" variant="ghost" size="icon-sm" className={cn(iconButton, 'hidden sm:inline-flex')} onClick={() => setLayout(minimized ? 'docked' : 'minimized')} aria-label={i18n._(minimized ? 'Restore' : 'Minimize')} title={i18n._(minimized ? 'Restore' : 'Minimize')}><Minus /></Button>
        {!minimized && <Button type="button" variant="ghost" size="icon-sm" className={cn(iconButton, 'hidden sm:inline-flex')} onClick={() => setLayout(expanded ? 'docked' : 'expanded')} aria-label={i18n._(expanded ? 'Exit full screen' : 'Expand')} title={i18n._(expanded ? 'Exit full screen' : 'Expand')}>{expanded ? <Minimize2 /> : <Maximize2 />}</Button>}
        <Button type="button" variant="ghost" size="icon-sm" className={iconButton} onClick={close} aria-label={i18n._('Close')} title={i18n._('Close')}><X /></Button>
      </header>

      <div className={cn('flex min-h-0 flex-1 flex-col', minimized && 'hidden')}>
        <div className="shrink-0 divide-y px-4 text-sm">
          <div className="flex h-10 items-center gap-3">
            <span className="w-14 shrink-0 text-muted-foreground"><Trans id="From" /></span>
            {mailboxes.length > 1
              ? <Select value={from} onValueChange={edit(setFrom)}>
                <SelectTrigger aria-label={i18n._('From')} className="h-8 min-w-0 flex-1 justify-start rounded-md border-0 bg-transparent px-2 shadow-none hover:bg-muted [&>span]:truncate"><SelectValue /></SelectTrigger>
                <SelectContent align="start">{mailboxes.map((item) => <SelectItem key={item.id} value={item.id}><span className="font-medium">{item.name || item.address}</span>{item.name && <span className="ml-2 text-muted-foreground">{item.address}</span>}</SelectItem>)}</SelectContent>
              </Select>
              : <span className="truncate">{mailbox?.name ? `${mailbox.name} <${mailbox.address}>` : mailbox?.address ?? '—'}</span>}
          </div>
          <label className="flex h-10 items-center gap-3">
            <span className="w-14 shrink-0 text-muted-foreground"><Trans id="To" /></span>
            <input name="to" type="email" value={to} onChange={(event) => edit(setTo)(event.target.value)} required autoFocus={!draft.to} placeholder={i18n._('Recipient')} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60" />
          </label>
          <label className="flex h-10 items-center gap-3">
            <span className="w-14 shrink-0 text-muted-foreground"><Trans id="Subject" /></span>
            <input name="subject" value={subject} onChange={(event) => edit(setSubject)(event.target.value)} placeholder={i18n._('Subject')} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60" />
          </label>
        </div>
        <textarea ref={bodyRef} name="text" value={text} onChange={(event) => edit(setText)(event.target.value)} required aria-label={i18n._('Message')} placeholder={i18n._('Write your message')} className="min-h-0 flex-1 resize-none bg-transparent p-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60" />

        {files.length > 0 && <ul className="flex shrink-0 flex-wrap gap-2 border-t px-4 py-3">
          {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex max-w-full items-center gap-2 rounded-lg border bg-muted/60 py-1 pr-1 pl-3 text-xs">
            <Paperclip className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate font-medium">{file.name}</span><span className="shrink-0 text-muted-foreground">{formatSize(file.size)}</span>
            <Button type="button" variant="ghost" size="icon-sm" className="size-6 rounded-md" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} aria-label={i18n._('Remove')} title={i18n._('Remove')}><X className="size-3.5" /></Button>
          </li>)}
        </ul>}
        {scheduledAt && <p className="flex shrink-0 items-center gap-2 border-t bg-primary/5 px-4 py-2 text-xs text-primary"><CalendarClock className="size-3.5" /><Trans id="Scheduled for" /> {new Date(scheduledAt).toLocaleString(i18n.locale)}<button type="button" className="ml-auto underline" onClick={() => setScheduledAt('')}><Trans id="Cancel" /></button></p>}
        {error && <p role="alert" className="shrink-0 border-t bg-red-500/10 px-4 py-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <footer className="relative flex shrink-0 items-center gap-1 border-t px-3 py-2">
          <div className="flex overflow-hidden rounded-full shadow-sm">
            <Button type="submit" className="h-9 rounded-none rounded-l-full px-5" disabled={sending || !from}>{sending ? <LoaderCircle className="animate-spin" /> : <Send />}{scheduledAt ? <Trans id="Schedule" /> : <Trans id="Send" />}</Button>
            <Button type="button" className="h-9 w-8 rounded-none rounded-r-full border-l border-primary-foreground/20 px-0" disabled={sending} onClick={() => setMenu(menu === 'schedule' ? null : 'schedule')} aria-label={i18n._('Schedule send')} title={i18n._('Schedule send')} aria-expanded={menu === 'schedule'}><ChevronDown /></Button>
          </div>
          <label className="ml-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground" title={i18n._('Attach files')}>
            <Paperclip className="size-4" /><span className="sr-only"><Trans id="Attach files" /></span>
            <input className="sr-only" type="file" multiple onChange={(event) => { const picked = Array.from(event.target.files ?? []); if (picked.length) setFiles((current) => [...current, ...picked].slice(0, 10)); event.target.value = '' }} />
          </label>
          {templates.length > 0 && <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" onClick={() => setMenu(menu === 'templates' ? null : 'templates')} aria-label={i18n._('Insert template')} title={i18n._('Insert template')} aria-expanded={menu === 'templates'}><FileText /></Button>}
          <span className="ml-auto truncate text-xs text-muted-foreground" aria-live="polite">{saveState === 'saving' ? i18n._('Saving…') : saveState === 'saved' ? i18n._('Draft saved') : ''}</span>
          <Button type="button" variant="ghost" size="icon" className="text-muted-foreground" onClick={() => void discard()} aria-label={i18n._('Discard draft')} title={i18n._('Discard draft')}><Trash2 /></Button>

          {menu === 'schedule' && <div className="absolute bottom-full left-3 z-10 mb-2 grid w-72 gap-3 rounded-xl border bg-popover p-3 text-sm shadow-xl">
            <p className="flex items-center gap-2 font-medium"><CalendarClock className="size-4" /><Trans id="Schedule send" /></p>
            <input type="datetime-local" value={scheduledAt} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} onChange={(event) => setScheduledAt(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={() => { setScheduledAt(''); setMenu(null) }}><Trans id="Send now" /></Button><Button type="button" size="sm" disabled={!scheduledAt} onClick={() => setMenu(null)}><Trans id="Schedule" /></Button></div>
          </div>}
          {menu === 'templates' && <ul className="absolute bottom-full left-3 z-10 mb-2 max-h-64 w-72 overflow-y-auto rounded-xl border bg-popover p-1 text-sm shadow-xl" role="menu">
            {templates.map((template) => <li key={template.id}><button type="button" role="menuitem" className="w-full rounded-lg px-3 py-2 text-left hover:bg-accent" onClick={() => { dirty.current = true; setSubject(template.subject); setText(template.textBody); setMenu(null); bodyRef.current?.focus() }}><span className="block truncate font-medium">{template.name}</span>{template.subject && <span className="block truncate text-xs text-muted-foreground">{template.subject}</span>}</button></li>)}
          </ul>}
        </footer>
      </div>
    </form>
  </>
}
