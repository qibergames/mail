import { Trans, useLingui } from '@lingui/react'
import { Link } from '@tanstack/react-router'
import {
  Archive,
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  CornerUpLeft,
  FileText,
  Forward,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  MailOpen,
  Menu,
  MoonStar,
  Paperclip,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Star,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button } from './ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { authClient } from '@/lib/auth-client'
import { resolveInlineImages } from '@/lib/email/html'
import type { SecurityDetails } from '@/lib/email/security'
import { clampMessageListWidth } from '@/lib/mail-layout'
import { cn } from '@/lib/utils'

export type MailView = 'inbox' | 'sent' | 'drafts' | 'starred' | 'snoozed' | 'archived' | 'spam' | 'trash'

type Mailbox = { id: string; name: string | null; address: string; type: string }
type Folder = { id: string; mailboxId: string; name: string; color: string }
type Message = {
  id: string
  fromAddr: string
  toAddr: string
  subject: string | null
  snippet: string | null
  textBody: string | null
  htmlBody: string | null
  status: string
  read: boolean
  starred: boolean
  createdAt: string
}
type Attachment = { id: string; filename: string; contentType: string; size: number; contentId: string | null }
type MessageDetail = { message: Message; attachments: Array<Attachment>; security: SecurityDetails | null }
type Draft = { id?: string; to?: string; subject?: string; text?: string }

function senderParts(value: string) {
  const address = value.match(/<([^>]+)>/)?.[1]
  if (!address) return { name: value, address: value }
  const name = value.slice(0, value.indexOf('<')).trim().replace(/^"([\s\S]*)"$/, '$1').replaceAll('\\"', '"').replaceAll('\\\\', '\\')
  return { name: name || address, address }
}

function relativeTime(date: Date, locale: string) {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return formatter.format(days, 'day')
  const months = Math.round(days / 30)
  if (Math.abs(months) < 12) return formatter.format(months, 'month')
  return formatter.format(Math.round(months / 12), 'year')
}

const navigation = [
  { view: 'inbox', href: '/inbox', icon: Inbox, label: 'Inbox' },
  { view: 'starred', href: '/starred', icon: Star, label: 'Starred' },
  { view: 'snoozed', href: '/snoozed', icon: MoonStar, label: 'Snoozed' },
  { view: 'sent', href: '/sent', icon: Send, label: 'Sent' },
  { view: 'drafts', href: '/drafts', icon: FileText, label: 'Drafts' },
  { view: 'archived', href: '/archived', icon: Archive, label: 'Archived' },
  { view: 'spam', href: '/spam', icon: ShieldAlert, label: 'Spam' },
  { view: 'trash', href: '/trash', icon: Trash2, label: 'Trash' },
] as const

export function MailApp({ view, folderId }: { view: MailView; folderId?: string }) {
  const { i18n } = useLingui()
  const { data: session } = authClient.useSession()
  const [mailboxes, setMailboxes] = useState<Array<Mailbox>>([])
  const [mailboxId, setMailboxId] = useState('')
  const [folders, setFolders] = useState<Array<Folder>>([])
  const [messages, setMessages] = useState<Array<Message>>([])
  const [selected, setSelected] = useState<Message | null>(null)
  const [selectedAttachments, setSelectedAttachments] = useState<Array<Attachment>>([])
  const [selectedSecurity, setSelectedSecurity] = useState<SecurityDetails | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Array<string>>([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [composer, setComposer] = useState<Draft | null>(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [listWidth, setListWidth] = useState(416)
  const listWidthRef = useRef(416)
  const splitRef = useRef<HTMLDivElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetch('/api/mailboxes').then((response) => response.json<Array<Mailbox>>()).then((rows) => {
      setMailboxes(rows)
      setMailboxId((current) => current || rows[0]?.id || '')
    })
  }, [])

  useEffect(() => {
    void fetch('/api/folders').then((response) => response.json<Array<Folder>>()).then(setFolders)
  }, [])

  useEffect(() => {
    const folder = folders.find((item) => item.id === folderId)
    if (folder) setMailboxId(folder.mailboxId)
  }, [folderId, folders])

  useEffect(() => {
    const messageId = new URLSearchParams(location.search).get('message')
    if (!messageId) return
    void fetch(`/api/messages/${encodeURIComponent(messageId)}`).then(async (response) => {
      if (!response.ok) return
      const detail = await response.json<MessageDetail>()
      setSelected(detail.message)
      setSelectedAttachments(detail.attachments)
      setSelectedSecurity(detail.security)
      setDetailsOpen(false)
      if (!detail.message.read) await updateMessage(detail.message.id, { read: true })
    })
  }, [])

  useEffect(() => {
    if (!mailboxId) return
    setLoading(true)
    const params = new URLSearchParams({ view, mailboxId })
    if (folderId) params.set('folderId', folderId)
    if (search) params.set('q', search)
    void fetch(`/api/messages?${params}`).then((response) => response.json<Array<Message>>()).then((rows) => {
      setMessages(rows)
      setSelected((current) => rows.find((message) => message.id === current?.id) ?? null)
      setSelectedIds([])
      setLoading(false)
    })
  }, [folderId, mailboxId, refresh, search, view])

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${location.host}/api/realtime`)
    socket.onmessage = () => setRefresh((value) => value + 1)
    if ('clearAppBadge' in navigator) void navigator.clearAppBadge()
    return () => socket.close()
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem('qibermail-message-list-width')
    const saved = stored === null ? listWidthRef.current : Number(stored)
    if (Number.isFinite(saved)) listWidthRef.current = saved
    const fit = () => {
      const width = clampMessageListWidth(listWidthRef.current, splitRef.current?.getBoundingClientRect().width ?? window.innerWidth)
      listWidthRef.current = width
      setListWidth(width)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  async function selectMessage(message: Message) {
    const response = await fetch(`/api/messages/${message.id}`)
    if (!response.ok) return
    const detail = await response.json<MessageDetail>()
    setSelected(detail.message)
    setSelectedAttachments(detail.attachments)
    setSelectedSecurity(detail.security)
    setDetailsOpen(false)
    if (!detail.message.read) {
      await updateMessage(detail.message.id, { read: true })
    }
  }

  async function updateMessage(id: string, changes: { read?: boolean; starred?: boolean; status?: string }) {
    await fetch(`/api/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    setRefresh((value) => value + 1)
  }

  async function bulk(changes: { read?: boolean; starred?: boolean; status?: 'received' | 'archived' | 'spam' | 'trash' }) {
    await fetch('/api/messages/bulk', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selectedIds, ...changes }) })
    setSelectedIds([])
    setRefresh((value) => value + 1)
  }

  function recipient(address: string) {
    return address.match(/<([^>]+)>/)?.[1] ?? address
  }

  async function logout() {
    await authClient.signOut()
    location.assign('/login')
  }

  function resizeList(clientX: number) {
    const rect = splitRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = clampMessageListWidth(clientX - rect.left, rect.width)
    listWidthRef.current = width
    setListWidth(width)
  }

  function saveListWidth() {
    localStorage.setItem('qibermail-message-list-width', String(listWidthRef.current))
  }

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 97,
    overscan: 8,
  })

  return (
    <main className="h-dvh overflow-hidden bg-muted p-0 md:p-4">
      <section className="mx-auto grid h-full max-w-[1600px] grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden bg-background md:grid-cols-[16rem_minmax(0,1fr)] md:rounded-3xl md:border md:shadow-xl">
        <aside className={cn('absolute inset-y-0 left-0 z-30 flex min-h-0 w-64 -translate-x-full flex-col gap-5 overflow-y-auto bg-sidebar p-4 transition-transform md:static md:translate-x-0', mobileMenu && 'translate-x-0')}>
          <div className="flex items-center gap-3 px-2 text-xl font-semibold"><span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Mail /></span>QiberMail</div>
          <Button className="h-12 justify-start rounded-2xl px-5" onClick={() => setComposer({})}><Mail /><Trans id="Compose" /></Button>
          <nav className="grid gap-1" aria-label={i18n._('Mail folders')}>
            {navigation.map(({ href, icon: Icon, label, view: itemView }) => (
              <Button key={href} asChild variant={view === itemView ? 'secondary' : 'ghost'} className="justify-start rounded-full">
                <Link to={href}><Icon /><Trans id={label} /></Link>
              </Button>
            ))}
          </nav>
          {folders.some((folder) => folder.mailboxId === mailboxId) && <nav className="grid gap-1 border-t pt-3" aria-label={i18n._('Custom folders')}>{folders.filter((folder) => folder.mailboxId === mailboxId).map((folder) => <Button key={folder.id} asChild variant={folder.id === folderId ? 'secondary' : 'ghost'} className="justify-start rounded-full"><Link to="/folders/$folderId" params={{ folderId: folder.id }}><span className="size-2 rounded-full" style={{ backgroundColor: folder.color }} />{folder.name}</Link></Button>)}</nav>}
          <div className="mt-auto grid gap-3">
            <Select value={mailboxId} onValueChange={setMailboxId}>
              <SelectTrigger aria-label={i18n._('Mailbox')} className="h-10 w-full rounded-xl bg-background/60 shadow-none">
                <SelectValue placeholder={i18n._('Mailbox')} />
              </SelectTrigger>
              <SelectContent>
                {mailboxes.map((mailbox) => <SelectItem key={mailbox.id} value={mailbox.id}>{mailbox.name || mailbox.address}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button asChild variant="ghost" className="justify-start"><Link to="/settings/$section" params={{ section: 'profile' }}><Settings /><Trans id="Settings" /></Link></Button>
            <Button asChild variant="ghost" className="justify-start"><Link to="/tools/$section" params={{ section: 'contacts' }}><Wrench /><Trans id="Tools" /></Link></Button>
            {session?.user.role === 'admin' && <Button asChild variant="ghost" className="justify-start"><Link to="/admin/$section" params={{ section: 'accounts' }}><ShieldAlert /><Trans id="Administration" /></Link></Button>}
            <Button variant="ghost" className="justify-start" onClick={logout}><LogOut /><Trans id="Sign out" /></Button>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col">
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-3 md:px-5">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileMenu((open) => !open)} aria-label={i18n._('Menu')} title={i18n._('Menu')}><Menu /></Button>
            <form className="flex min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); setSearch(query) }}>
              <div className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full bg-muted px-4"><Search className="size-5 text-muted-foreground" /><Input className="h-auto border-0 p-0 shadow-none focus-visible:ring-0" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={i18n._('Search mail')} /></div>
            </form>
          </header>

          <div ref={splitRef} className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden md:grid-cols-[var(--message-list-width)_0_minmax(0,1fr)]" style={{ '--message-list-width': `${listWidth}px` } as React.CSSProperties}>
            <section className={cn('flex h-full min-h-0 flex-col overflow-hidden border-r', selected && 'hidden md:flex')}>
              <div className="flex h-14 shrink-0 items-center gap-1 border-b px-4">
                {selectedIds.length ? <><span className="mr-2 text-sm">{selectedIds.length}</span><Button variant="ghost" size="icon" onClick={() => bulk({ read: true })} aria-label={i18n._('Mark read')} title={i18n._('Mark read')}><Mail /></Button><Button variant="ghost" size="icon" onClick={() => bulk({ status: 'archived' })} aria-label={i18n._('Archive')} title={i18n._('Archive')}><Archive /></Button><Button variant="ghost" size="icon" onClick={() => bulk({ status: 'trash' })} aria-label={i18n._('Delete')} title={i18n._('Delete')}><Trash2 /></Button></> : <><h1 className="font-semibold">{folderId ? folders.find((folder) => folder.id === folderId)?.name : <Trans id={navigation.find((item) => item.view === view)?.label ?? 'Inbox'} />}</h1><span className="ml-auto text-sm text-muted-foreground">{messages.length}</span></>}
              </div>
              <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto">
                {loading && <div className="grid place-items-center p-12"><LoaderCircle className="animate-spin" /></div>}
                {!loading && messages.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground"><Trans id="No messages here." /></p>}
                <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
                  {rowVirtualizer.getVirtualItems().map((row) => {
                    const message = messages[row.index]
                    return <ContextMenu key={message.id}>
                      <ContextMenuTrigger asChild>
                        <div data-index={row.index} ref={rowVirtualizer.measureElement} style={{ transform: `translateY(${row.start}px)` }} className={cn('absolute inset-x-0 top-0 flex border-b border-l-4 border-l-transparent hover:bg-muted/70', !message.read && 'border-l-primary bg-primary/10', selected?.id === message.id && 'bg-secondary')}><label className="grid w-11 shrink-0 place-items-center"><input type="checkbox" checked={selectedIds.includes(message.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, message.id] : ids.filter((id) => id !== message.id))} aria-label={i18n._('Select')} /></label><button type="button" onClick={() => selectMessage(message)} className="grid min-w-0 flex-1 grid-cols-[1fr_auto] gap-2 p-4 pl-0 text-left"><span className="sr-only">{message.read ? i18n._('Read') : i18n._('Unread')}</span><span className="min-w-0"><span className={cn('block truncate text-sm', message.read ? 'text-muted-foreground' : 'font-semibold')}>{view === 'sent' ? message.toAddr : message.fromAddr}</span><span className={cn('mt-1 block truncate text-sm', message.read ? 'text-muted-foreground' : 'font-semibold')}>{message.subject || i18n._('(No subject)')}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{message.snippet}</span></span><span className={cn('text-xs', message.read ? 'text-muted-foreground' : 'font-semibold')}>{new Date(message.createdAt).toLocaleDateString(i18n.locale)}</span></button></div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onSelect={() => updateMessage(message.id, { read: !message.read })}>{message.read ? <><Mail /><Trans id="Mark unread" /></> : <><MailOpen /><Trans id="Mark read" /></>}</ContextMenuItem>
                        <ContextMenuItem onSelect={() => updateMessage(message.id, { starred: !message.starred })}><Star className={message.starred ? 'fill-yellow-400 text-yellow-500' : ''} />{message.starred ? <Trans id="Unstar" /> : <Trans id="Star" />}</ContextMenuItem>
                        <ContextMenuSeparator />
                        {['archived', 'spam', 'trash'].includes(message.status)
                          ? <ContextMenuItem onSelect={() => updateMessage(message.id, { status: 'received' })}><Inbox /><Trans id="Move to inbox" /></ContextMenuItem>
                          : <ContextMenuItem onSelect={() => updateMessage(message.id, { status: 'archived' })}><Archive /><Trans id="Archive" /></ContextMenuItem>}
                        {message.status !== 'spam' && <ContextMenuItem onSelect={() => updateMessage(message.id, { status: 'spam' })}><ShieldAlert /><Trans id="Mark as spam" /></ContextMenuItem>}
                        {message.status !== 'trash' && <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => updateMessage(message.id, { status: 'trash' })}><Trash2 /><Trans id="Delete" /></ContextMenuItem>}
                      </ContextMenuContent>
                    </ContextMenu>
                  })}
                </div>
              </div>
            </section>

            <button
              type="button"
              role="separator"
              aria-label={i18n._('Resize message list')}
              aria-orientation="vertical"
              aria-valuemin={288}
              aria-valuemax={1600}
              aria-valuenow={Math.round(listWidth)}
              className="group relative z-10 hidden h-full w-3 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none md:block"
              onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
              onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeList(event.clientX) }}
              onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); saveListWidth() }}
              onPointerCancel={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                const width = clampMessageListWidth(listWidthRef.current + (event.key === 'ArrowLeft' ? -24 : 24), splitRef.current?.getBoundingClientRect().width ?? window.innerWidth)
                listWidthRef.current = width
                setListWidth(width)
                saveListWidth()
              }}
            ><span className="absolute inset-y-0 left-1/2 w-px bg-border group-hover:bg-primary group-focus-visible:w-0.5 group-focus-visible:bg-primary" /></button>

            <section className={cn('h-full min-h-0 overflow-y-auto', !selected && 'hidden md:block')}>
              {selected ? (
                <>
                  <div className="sticky top-0 z-10 flex min-h-16 items-center gap-1 border-b bg-background/95 px-3 backdrop-blur md:px-5">
                    <Button variant="ghost" size="icon" onClick={() => setSelected(null)} aria-label={i18n._('Back to message list')} title={i18n._('Back to message list')}><ArrowLeft /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Star')} title={i18n._('Star')} onClick={() => updateMessage(selected.id, { starred: !selected.starred })}><Star className={selected.starred ? 'fill-yellow-400 text-yellow-500' : ''} /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Archive')} title={i18n._('Archive')} onClick={() => updateMessage(selected.id, { status: 'archived' })}><Archive /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Snooze one day')} title={i18n._('Snooze one day')} onClick={() => fetch(`/api/messages/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snoozedUntil: new Date(Date.now() + 86_400_000).toISOString() }) }).then(() => setRefresh((value) => value + 1))}><CalendarClock /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Delete')} title={i18n._('Delete')} onClick={() => updateMessage(selected.id, { status: 'trash' })}><Trash2 /></Button>
                    {selected.status === 'draft' ? <Button className="ml-auto" onClick={() => setComposer({ id: selected.id, to: selected.toAddr, subject: selected.subject ?? '', text: selected.textBody ?? '' })}><Trans id="Edit draft" /></Button> : <><Button className="ml-auto" variant="outline" onClick={() => setComposer({ to: recipient(selected.fromAddr), subject: selected.subject?.startsWith('Re:') ? selected.subject : `Re: ${selected.subject ?? ''}`, text: `\n\n---\n${selected.textBody ?? ''}` })}><CornerUpLeft /><Trans id="Reply" /></Button><Button variant="outline" onClick={() => setComposer({ subject: selected.subject?.startsWith('Fwd:') ? selected.subject : `Fwd: ${selected.subject ?? ''}`, text: `\n\n---\n${selected.textBody ?? ''}` })}><Forward /><Trans id="Forward" /></Button></>}
                  </div>
                <article className="mx-auto w-full max-w-6xl p-4 md:p-8">
                  <h2 className="text-2xl font-semibold">{selected.subject || i18n._('(No subject)')}</h2>
                  <MessageHeader message={selected} security={selectedSecurity} open={detailsOpen} onToggle={() => setDetailsOpen((value) => !value)} ownAddresses={mailboxes.map((mailbox) => mailbox.address)} />
                  {selected.htmlBody ? <iframe title={i18n._('Message content')} sandbox="allow-same-origin" referrerPolicy="no-referrer" className="mt-8 min-h-96 w-full border-0 bg-white" onLoad={(event) => { event.currentTarget.style.height = `${event.currentTarget.contentDocument?.documentElement.scrollHeight ?? 384}px` }} srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:">${resolveInlineImages(selected.htmlBody, selected.id, selectedAttachments)}`} /> : <pre className="mt-8 whitespace-pre-wrap break-words font-sans text-sm leading-7">{selected.textBody || i18n._('This message has no plain-text body.')}</pre>}
                  {selectedAttachments.length > 0 && <div className="mt-8 flex flex-wrap gap-2">{selectedAttachments.map((attachment) => <a key={attachment.id} className="rounded-md border px-3 py-2 text-sm hover:bg-muted" href={`/api/messages/${selected.id}/attachments/${attachment.id}`}>{attachment.filename} · {(attachment.size / 1024).toFixed(0)} KB</a>)}</div>}
                </article>
                </>
              ) : <div className="grid h-full place-items-center text-sm text-muted-foreground"><Trans id="Select a message to read it." /></div>}
            </section>
          </div>
        </div>
      </section>
      {mobileMenu && <button type="button" aria-label={i18n._('Close menu')} className="absolute inset-0 z-20 bg-black/30 md:hidden" onClick={() => setMobileMenu(false)} />}
      {composer && <Composer mailboxId={mailboxId} draft={composer} close={() => setComposer(null)} sent={() => { setComposer(null); setRefresh((value) => value + 1) }} />}
    </main>
  )
}

function MessageHeader({ message, security, open, onToggle, ownAddresses }: { message: Message; security: SecurityDetails | null; open: boolean; onToggle: () => void; ownAddresses: Array<string> }) {
  const { i18n } = useLingui()
  const from = senderParts(message.fromAddr)
  const to = senderParts(message.toAddr)
  const parsedDate = security?.date ? Date.parse(security.date) : Number.NaN
  const date = Number.isNaN(parsedDate) ? new Date(message.createdAt) : new Date(parsedDate)
  const dateLabel = date.toLocaleString(i18n.locale, { dateStyle: 'long', timeStyle: 'short' })
  const authFailed = security !== null && [security.spf, security.dkim, security.dmarc].includes('fail')
  const label = (id: string) => <dt className="text-right lowercase text-muted-foreground"><Trans id={id} />:</dt>
  return (
    <div className="mt-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-base font-semibold text-primary">{from.name.charAt(0).toUpperCase() || '?'}</span>
        <div className="relative min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <strong className="truncate text-sm">{from.name}</strong>
            {from.address !== from.name && <span className="truncate text-xs text-muted-foreground">&lt;{from.address}&gt;</span>}
            <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">{dateLabel} ({relativeTime(date, i18n.locale)})</span>
          </div>
          <button type="button" onClick={onToggle} aria-expanded={open} className="mt-0.5 flex items-center gap-0.5 rounded text-xs text-muted-foreground hover:text-foreground" aria-label={i18n._('Message details')} title={i18n._('Message details')}>
            <span className="lowercase"><Trans id="To" /></span>: {ownAddresses.includes(to.address) ? i18n._('me') : to.address}
            <ChevronDown className="size-3.5" />
          </button>
          {open && <button type="button" tabIndex={-1} aria-label={i18n._('Close')} className="fixed inset-0 z-10 cursor-default" onClick={onToggle} />}
          {open && (
            <div className="absolute left-0 top-full z-20 mt-1 w-full max-w-md rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                {label('From')}
                <dd className="min-w-0 break-words"><strong>{from.name}</strong>{from.address !== from.name && <span className="text-muted-foreground"> &lt;{from.address}&gt;</span>}</dd>
                {label('To')}
                <dd className="min-w-0 break-words">{to.address}</dd>
                {label('Date')}
                <dd>{dateLabel}</dd>
                {label('Subject')}
                <dd className="min-w-0 break-words">{message.subject || i18n._('(No subject)')}</dd>
                {security?.mailedBy && <>{label('Mailed by')}<dd className="min-w-0 break-words">{security.mailedBy}</dd></>}
                {security?.signedBy && <>{label('Signed by')}<dd className="min-w-0 break-words">{security.signedBy}</dd></>}
                {security && (
                  <>
                    {label('Security')}
                    <dd className="flex items-center gap-1.5">
                      {security.encryption === 'tls'
                        ? <><LockKeyhole className="size-3.5 shrink-0 text-muted-foreground" /><Trans id="Standard encryption (TLS)" /></>
                        : <><TriangleAlert className="size-3.5 shrink-0 text-amber-500" /><Trans id="No encryption" /></>}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
      {authFailed && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-4 shrink-0" />
          <Trans id="This message failed sender verification. Be careful with links and attachments." />
        </p>
      )}
    </div>
  )
}

function Composer({ mailboxId, draft, close, sent }: { mailboxId: string; draft: Draft; close: () => void; sent: () => void }) {
  const { i18n } = useLingui()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [draftId, setDraftId] = useState(draft.id)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; subject: string; textBody: string }>>([])

  useEffect(() => {
    void fetch('/api/tools').then((response) => response.json<{ templates: Array<{ id: string; name: string; subject: string; textBody: string }> }>()).then((data) => setTemplates(data.templates))
  }, [])

  function autosave(form: HTMLFormElement) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const data = new FormData(form)
      const response = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draftId, mailboxId, to: data.get('to'), subject: data.get('subject'), text: data.get('text') }),
      })
      if (response.ok) setDraftId((await response.json<{ id: string }>()).id)
    }, 800)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSending(true)
    setError('')
    const data = new FormData(event.currentTarget)
    const files = data.getAll('attachments').filter((item): item is File => item instanceof File && item.size > 0)
    const attachments = await Promise.all(files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return { filename: file.name, type: file.type || 'application/octet-stream', content: btoa(binary) }
    }))
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mailboxId,
        draftId,
        to: data.get('to'),
        subject: data.get('subject'),
        text: data.get('text'),
        scheduledAt: data.get('scheduledAt') ? new Date(String(data.get('scheduledAt'))).toISOString() : undefined,
        attachments,
      }),
    })
    setSending(false)
    if (!response.ok) {
      const result = await response.json<{ error?: string }>().catch(() => null)
      return setError(result?.error ?? i18n._('Send failed'))
    }
    sent()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="composer-title">
      <form ref={formRef} onSubmit={submit} onInput={(event) => autosave(event.currentTarget)} className="grid max-h-dvh w-full max-w-2xl gap-4 overflow-y-auto rounded-t-2xl bg-background p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-center"><h2 id="composer-title" className="text-lg font-semibold"><Trans id="New message" /></h2><Button type="button" variant="ghost" size="icon" className="ml-auto" onClick={close} aria-label={i18n._('Close')} title={i18n._('Close')}><X /></Button></div>
        {templates.length > 0 && <select aria-label={i18n._('Template')} className="h-10 rounded-md border bg-background px-3 text-sm" defaultValue="" onChange={(event) => { const template = templates.find((item) => item.id === event.target.value); const form = formRef.current; if (!template || !form) return; (form.elements.namedItem('subject') as HTMLInputElement).value = template.subject; (form.elements.namedItem('text') as HTMLTextAreaElement).value = template.textBody; autosave(form) }}><option value=""><Trans id="Choose template" /></option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>}
        <div className="grid gap-2"><Label htmlFor="compose-to"><Trans id="To" /></Label><Input id="compose-to" name="to" type="email" defaultValue={draft.to} required /></div>
        <div className="grid gap-2"><Label htmlFor="compose-subject"><Trans id="Subject" /></Label><Input id="compose-subject" name="subject" defaultValue={draft.subject} /></div>
        <textarea name="text" defaultValue={draft.text} aria-label={i18n._('Message')} className="min-h-56 resize-y rounded-md border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" required />
        <div className="grid gap-2"><Label htmlFor="compose-scheduled"><Trans id="Schedule send" /></Label><Input id="compose-scheduled" name="scheduledAt" type="datetime-local" /></div>
        <div className="flex flex-wrap items-center gap-2"><Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2"><Paperclip className="size-4" /><Trans id="Attachments" /><input className="sr-only" name="attachments" type="file" multiple /></Label><Button className="ml-auto" disabled={sending || !mailboxId}>{sending ? <LoaderCircle className="animate-spin" /> : <Send />}<Trans id="Send" /></Button></div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  )
}
