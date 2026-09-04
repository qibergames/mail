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
  CloudOff,
  LogOut,
  Mail,
  MailOpen,
  Menu,
  MoonStar,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Star,
  Trash2,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Composer } from './composer'
import type { Draft } from './composer'
import { Button } from './ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { authClient } from '@/lib/auth-client'
import { resolveInlineImages } from '@/lib/email/html'
import type { SecurityDetails } from '@/lib/email/security'
import { clampMessageListWidth } from '@/lib/mail-layout'
import { mailStore } from '@/lib/mail-store'
import type { MessageSummary } from '@/lib/mail-store'
import { cn } from '@/lib/utils'

export type MailView = 'inbox' | 'sent' | 'drafts' | 'starred' | 'snoozed' | 'archived' | 'spam' | 'trash'

type Mailbox = { id: string; name: string | null; address: string; type: string }
type Folder = { id: string; mailboxId: string; name: string; color: string }
type Message = MessageSummary
type Attachment = { id: string; filename: string; contentType: string; size: number; contentId: string | null }
type MessageDetail = { message: Message & { textBody: string | null; htmlBody: string | null }; attachments: Array<Attachment>; security: SecurityDetails | null }
type Body = { textBody: string | null; htmlBody: string | null }

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

const MAILBOX_STORAGE_KEY = 'qibermail:mailbox'

function readSearch(key: string) {
  return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(key)
}

function writeSearch(changes: Record<string, string | null>) {
  if (typeof history === 'undefined') return
  const url = new URL(location.href)
  for (const [key, value] of Object.entries(changes)) {
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
  }
  if (url.href !== location.href) history.replaceState(history.state, '', url)
}

function storedMailbox() {
  try { return localStorage.getItem(MAILBOX_STORAGE_KEY) } catch { return null }
}

export function MailApp({ view, folderId }: { view: MailView; folderId?: string }) {
  const { i18n } = useLingui()
  const { data: session } = authClient.useSession()
  const [mailboxes, setMailboxes] = useState<Array<Mailbox>>([])
  const [mailboxId, setMailboxId] = useState('')
  const [folders, setFolders] = useState<Array<Folder>>([])
  const storeVersion = useSyncExternalStore(mailStore.subscribe, mailStore.getVersion, () => 0)
  const [searchResults, setSearchResults] = useState<Array<Message> | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() => readSearch('message'))
  const [selectedBody, setSelectedBody] = useState<(Body & { id: string }) | null>(null)
  const [selectedAttachments, setSelectedAttachments] = useState<Array<Attachment>>([])
  const [selectedSecurity, setSelectedSecurity] = useState<SecurityDetails | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Array<string>>([])
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [composer, setComposer] = useState<Draft | null>(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [listWidth, setListWidth] = useState(416)
  const listWidthRef = useRef(416)
  const splitRef = useRef<HTMLDivElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const apply = (rows: Array<Mailbox>) => {
      setMailboxes(rows)
      const preferred = readSearch('mailbox') ?? storedMailbox()
      setMailboxId((current) => current || (preferred && rows.some((row) => row.id === preferred) ? preferred : rows[0]?.id || ''))
    }
    void mailStore.readMeta<Array<Mailbox>>('mailboxes').then((cached) => { if (cached?.length) apply(cached) })
    void fetch('/api/mailboxes').then((response) => response.json<Array<Mailbox>>()).then((rows) => { apply(rows); void mailStore.writeMeta('mailboxes', rows) }).catch(() => undefined)
    void mailStore.start()
  }, [])

  useEffect(() => {
    if (!mailboxId) return
    try { localStorage.setItem(MAILBOX_STORAGE_KEY, mailboxId) } catch { /* storage unavailable */ }
    writeSearch({ mailbox: mailboxId })
  }, [mailboxId])

  useEffect(() => {
    writeSearch({ message: selectedId })
  }, [selectedId])

  useEffect(() => {
    void mailStore.readMeta<Array<Folder>>('folders').then((cached) => { if (cached) setFolders(cached) })
    void fetch('/api/folders').then((response) => response.json<Array<Folder>>()).then((rows) => { setFolders(rows); void mailStore.writeMeta('folders', rows) }).catch(() => undefined)
  }, [])

  useEffect(() => {
    const folder = folders.find((item) => item.id === folderId)
    if (folder) setMailboxId(folder.mailboxId)
  }, [folderId, folders])

  // Search goes to the server (full-text over bodies); everything else is served from the local cache.
  useEffect(() => {
    if (!mailboxId || !search) { setSearchResults(null); setSearching(false); return }
    setSearching(true)
    const params = new URLSearchParams({ view, mailboxId, q: search })
    if (folderId) params.set('folderId', folderId)
    void fetch(`/api/messages?${params}`).then((response) => response.json<Array<Message>>()).then((rows) => { setSearchResults(rows); setSearching(false) }).catch(() => setSearching(false))
  }, [folderId, mailboxId, search, view])

  useEffect(() => { if (refresh) void mailStore.sync() }, [refresh])

  const localMessages = useMemo(() => mailboxId ? mailStore.select(view, mailboxId, folderId) : [], [storeVersion, view, mailboxId, folderId])
  const messages = search && searchResults ? searchResults : localMessages
  const loading = search ? searching : !mailStore.ready
  const selectedSummary = selectedId ? (messages.find((message) => message.id === selectedId) ?? mailStore.get(selectedId)) : null
  const selected = selectedSummary ? { ...selectedSummary, textBody: selectedBody?.id === selectedSummary.id ? selectedBody.textBody : null, htmlBody: selectedBody?.id === selectedSummary.id ? selectedBody.htmlBody : null } : null
  const bodyLoading = Boolean(selectedSummary) && selectedBody?.id !== selectedSummary?.id

  useEffect(() => { setSelectedIds([]) }, [view, mailboxId, folderId])

  // Load the open message body: from the cache first, then from the server (drafts are never cached).
  useEffect(() => {
    if (!selectedId) { setSelectedBody(null); setSelectedAttachments([]); setSelectedSecurity(null); return }
    const guard = { cancelled: false }
    const isCancelled = () => guard.cancelled
    const id = selectedId
    setDetailsOpen(false)
    void (async () => {
      const cached = await mailStore.getBody<Attachment, SecurityDetails>(id)
      if (isCancelled()) return
      if (cached && mailStore.get(id)?.status !== 'draft') {
        setSelectedBody({ id, textBody: cached.textBody, htmlBody: cached.htmlBody })
        setSelectedAttachments(cached.attachments)
        setSelectedSecurity(cached.security)
      }
      try {
        const response = await fetch(`/api/messages/${encodeURIComponent(id)}`)
        if (!response.ok || isCancelled()) return
        const detail = await response.json<MessageDetail>()
        if (isCancelled()) return
        setSelectedBody({ id, textBody: detail.message.textBody, htmlBody: detail.message.htmlBody })
        setSelectedAttachments(detail.attachments)
        setSelectedSecurity(detail.security)
        if (detail.message.status !== 'draft') void mailStore.putBody({ id, textBody: detail.message.textBody, htmlBody: detail.message.htmlBody, attachments: detail.attachments, security: detail.security, cachedAt: Date.now() })
      } catch { /* offline: keep whatever the cache had */ }
    })()
    const summary = mailStore.get(id)
    if (summary && !summary.read) void mailStore.update([id], { read: true })
    return () => { guard.cancelled = true }
  }, [selectedId])

  // Warm the body cache for the newest messages in view so they open instantly and read offline.
  useEffect(() => {
    if (!mailStore.ready || mailStore.offline || search) return
    const guard = { cancelled: false }
    const candidates = localMessages.slice(0, 20).filter((message) => message.status !== 'draft')
    const timer = setTimeout(async () => {
      for (const message of candidates) {
        if (guard.cancelled) return
        if (await mailStore.hasBody(message.id)) continue
        try {
          const response = await fetch(`/api/messages/${encodeURIComponent(message.id)}`)
          if (!response.ok) continue
          const detail = await response.json<MessageDetail>()
          await mailStore.putBody({ id: message.id, textBody: detail.message.textBody, htmlBody: detail.message.htmlBody, attachments: detail.attachments, security: detail.security, cachedAt: Date.now() })
        } catch { return }
      }
    }, 1500)
    return () => { guard.cancelled = true; clearTimeout(timer) }
  }, [localMessages, search])

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${location.host}/api/realtime`)
    socket.onmessage = () => void mailStore.sync()
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

  function selectMessage(message: Message) {
    setSelectedId(message.id)
  }

  function setSelected(message: Message | null) {
    setSelectedId(message?.id ?? null)
  }

  async function updateMessage(id: string, changes: { read?: boolean; starred?: boolean; status?: string; snoozedUntil?: string | null }) {
    await mailStore.update([id], changes)
  }

  async function bulk(changes: { read?: boolean; starred?: boolean; status?: 'received' | 'archived' | 'spam' | 'trash' }) {
    const ids = selectedIds
    setSelectedIds([])
    await mailStore.update(ids, changes)
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
    <main className="h-dvh overflow-hidden bg-muted p-0 md:p-2">
      <section className="mx-auto grid h-full max-w-[1800px] grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden bg-background md:grid-cols-[16rem_minmax(0,1fr)] md:rounded-xl md:border md:shadow-xl">
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
            {mailStore.offline && <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400" title={i18n._('Offline: showing cached mail')}><CloudOff className="size-3.5" /><span className="hidden sm:inline"><Trans id="Offline" /></span></span>}
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

            <section className={cn('h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto', !selected && 'hidden md:block')}>
              {selected ? (
                <>
                  <div className="sticky top-0 z-10 flex min-h-16 items-center gap-0.5 border-b bg-background/95 px-2 backdrop-blur sm:gap-1 sm:px-3 md:px-5">
                    <Button variant="ghost" size="icon" onClick={() => setSelected(null)} aria-label={i18n._('Back to message list')} title={i18n._('Back to message list')}><ArrowLeft /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Star')} title={i18n._('Star')} onClick={() => updateMessage(selected.id, { starred: !selected.starred })}><Star className={selected.starred ? 'fill-yellow-400 text-yellow-500' : ''} /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Archive')} title={i18n._('Archive')} onClick={() => updateMessage(selected.id, { status: 'archived' })}><Archive /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Snooze one day')} title={i18n._('Snooze one day')} onClick={() => updateMessage(selected.id, { snoozedUntil: new Date(Date.now() + 86_400_000).toISOString() })}><CalendarClock /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Delete')} title={i18n._('Delete')} onClick={() => updateMessage(selected.id, { status: 'trash' })}><Trash2 /></Button>
                    {selected.status === 'draft' ? <Button className="ml-auto" onClick={() => setComposer({ id: selected.id, to: selected.toAddr, subject: selected.subject ?? '', text: selected.textBody ?? '' })}><Trans id="Edit draft" /></Button> : <><Button className="ml-auto" variant="outline" aria-label={i18n._('Reply')} title={i18n._('Reply')} onClick={() => setComposer({ to: recipient(selected.fromAddr), subject: selected.subject?.startsWith('Re:') ? selected.subject : `Re: ${selected.subject ?? ''}`, text: `\n\n---\n${selected.textBody ?? ''}` })}><CornerUpLeft /><span className="hidden sm:inline"><Trans id="Reply" /></span></Button><Button variant="outline" aria-label={i18n._('Forward')} title={i18n._('Forward')} onClick={() => setComposer({ subject: selected.subject?.startsWith('Fwd:') ? selected.subject : `Fwd: ${selected.subject ?? ''}`, text: `\n\n---\n${selected.textBody ?? ''}` })}><Forward /><span className="hidden sm:inline"><Trans id="Forward" /></span></Button></>}
                  </div>
                <article className="mx-auto w-full min-w-0 max-w-6xl p-4 md:p-6 lg:px-8">
                  <h2 className="text-xl font-semibold break-words sm:text-2xl">{selected.subject || i18n._('(No subject)')}</h2>
                  <MessageHeader message={selected} security={selectedSecurity} open={detailsOpen} onToggle={() => setDetailsOpen((value) => !value)} ownAddresses={mailboxes.map((mailbox) => mailbox.address)} />
                  {bodyLoading && !selected.htmlBody && !selected.textBody ? <div className="mt-8 grid place-items-center p-12 text-muted-foreground">{mailStore.offline ? <span className="flex items-center gap-2 text-sm"><CloudOff className="size-4" /><Trans id="This message is not available offline yet." /></span> : <LoaderCircle className="animate-spin" />}</div> : selected.htmlBody ? <iframe title={i18n._('Message content')} sandbox="allow-same-origin" referrerPolicy="no-referrer" className="mt-6 min-h-96 w-[calc(100%+2rem)] max-w-none -mx-4 border-0 bg-white sm:mx-0 sm:w-full md:mt-8" onLoad={(event) => { event.currentTarget.style.height = `${event.currentTarget.contentDocument?.documentElement.scrollHeight ?? 384}px` }} srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;max-width:100%;overflow-x:hidden;word-break:break-word}img,table{max-width:100%!important;height:auto}</style>${resolveInlineImages(selected.htmlBody, selected.id, selectedAttachments)}`} /> : <pre className="mt-8 whitespace-pre-wrap break-words font-sans text-sm leading-7">{selected.textBody || i18n._('This message has no plain-text body.')}</pre>}
                  {selectedAttachments.length > 0 && <div className="mt-8 flex flex-wrap gap-2">{selectedAttachments.map((attachment) => <a key={attachment.id} className="rounded-md border px-3 py-2 text-sm hover:bg-muted" href={`/api/messages/${selected.id}/attachments/${attachment.id}`}>{attachment.filename} · {(attachment.size / 1024).toFixed(0)} KB</a>)}</div>}
                </article>
                </>
              ) : <div className="grid h-full place-items-center text-sm text-muted-foreground"><Trans id="Select a message to read it." /></div>}
            </section>
          </div>
        </div>
      </section>
      {mobileMenu && <button type="button" aria-label={i18n._('Close menu')} className="absolute inset-0 z-20 bg-black/30 md:hidden" onClick={() => setMobileMenu(false)} />}
      {composer && <Composer mailboxes={mailboxes} mailboxId={mailboxId} draft={composer} close={() => { setComposer(null); void mailStore.sync() }} sent={() => { setComposer(null); setRefresh((value) => value + 1) }} />}
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
