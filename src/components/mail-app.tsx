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
  ChevronUp,
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
import type { CachedBody, MessageSummary } from '@/lib/mail-store'
import { groupThreads } from '@/lib/email/threads'
import { QUOTE_STYLE, collapseQuotedHtml, quoteForReply, splitQuotedText } from '@/lib/email/quote'
import { cn } from '@/lib/utils'

export type MailView = 'inbox' | 'sent' | 'drafts' | 'starred' | 'snoozed' | 'archived' | 'spam' | 'trash'

type Mailbox = { id: string; name: string | null; address: string; type: string }
type Folder = { id: string; mailboxId: string; name: string; color: string }
type Message = MessageSummary
type Attachment = { id: string; filename: string; contentType: string; size: number; contentId: string | null }
type MessageDetail = { message: Message & { textBody: string | null; htmlBody: string | null }; attachments: Array<Attachment>; security: SecurityDetails | null }

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

const SELECTED_STORAGE_KEY = 'qibermail:selected-message'
const CONSUMED_URL_MESSAGE_KEY = 'qibermail:consumed-url-message'

function readSearch(key: string) {
  return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(key)
}

function tabState(key: string, value?: string | null) {
  try {
    if (value === undefined) return sessionStorage.getItem(key)
    if (value) sessionStorage.setItem(key, value)
    else sessionStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  return null
}

/**
 * The open message survives a refresh via sessionStorage. A ?message= link (push notification click)
 * wins the first time it is seen; after that the tab's own selection takes over, so closing a message
 * and refreshing does not reopen it. The URL itself is never rewritten: TanStack Router intercepts
 * history.replaceState and would treat it as a navigation.
 */
function initialSelectedMessage() {
  const fromUrl = readSearch('message')
  if (fromUrl && tabState(CONSUMED_URL_MESSAGE_KEY) !== fromUrl) {
    tabState(CONSUMED_URL_MESSAGE_KEY, fromUrl)
    return fromUrl
  }
  return tabState(SELECTED_STORAGE_KEY)
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
  const [selectedId, setSelectedId] = useState<string | null>(() => (typeof window === 'undefined' ? null : initialSelectedMessage()))
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
  }, [mailboxId])

  useEffect(() => {
    tabState(SELECTED_STORAGE_KEY, selectedId)
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
  const threads = useMemo(() => groupThreads(messages), [messages])
  // The open conversation spans every view of the mailbox (inbox + sent replies), except trash/spam/drafts
  // unless the selected message itself lives there.
  const conversation = useMemo(() => {
    if (!selectedId || !mailboxId) return null
    const all = mailStore.byMailbox(mailboxId)
    const own = all.find((message) => message.id === selectedId) ?? messages.find((message) => message.id === selectedId) ?? mailStore.get(selectedId)
    if (!own) return null
    const thread = groupThreads(all).find((item) => item.messages.some((message) => message.id === selectedId))
    const hidden = new Set(['trash', 'spam', 'draft'])
    const rows = (thread?.messages ?? [own]).filter((message) => message.id === own.id || !hidden.has(message.status) || message.status === own.status)
    return { ...groupThreads(rows)[0], selected: own }
  }, [storeVersion, selectedId, mailboxId, messages])
  const selected = conversation?.selected ?? null
  const threadIds = conversation?.messages.map((message) => message.id) ?? []
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const conversationKey = `${selectedId ?? ''}:${conversation?.count ?? 0}`
  useEffect(() => {
    if (!conversation) return
    setExpandedIds(new Set([conversation.latest.id, ...conversation.messages.filter((message) => !message.read).map((message) => message.id), conversation.selected.id]))
  }, [conversationKey])

  useEffect(() => { setSelectedIds([]) }, [view, mailboxId, folderId])

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

  // Realtime: keep a WebSocket to the user's hub, reconnect with backoff when it drops (deploys, sleep,
  // network changes), keep it alive with pings, and poll as a safety net while the tab is visible.
  useEffect(() => {
    const state: { socket: WebSocket | null; attempts: number; closed: boolean; timer?: ReturnType<typeof setTimeout>; ping?: ReturnType<typeof setInterval> } = { socket: null, attempts: 0, closed: false }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const connect = () => {
      if (state.closed || (state.socket && state.socket.readyState <= WebSocket.OPEN)) return
      const socket = new WebSocket(`${protocol}//${location.host}/api/realtime`)
      state.socket = socket
      socket.onopen = () => {
        state.attempts = 0
        void mailStore.sync()
        state.ping = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('ping') }, 25_000)
      }
      socket.onmessage = (event) => { if (event.data !== 'pong') void mailStore.sync() }
      socket.onerror = () => socket.close()
      socket.onclose = () => {
        if (state.ping) clearInterval(state.ping)
        if (state.socket === socket) state.socket = null
        if (state.closed) return
        const delay = Math.min(30_000, 1_000 * 2 ** state.attempts)
        state.attempts += 1
        state.timer = setTimeout(connect, delay)
      }
    }
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      void mailStore.sync()
      if (!state.socket) { clearTimeout(state.timer); state.attempts = 0; connect() }
    }
    connect()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void mailStore.sync() }, 60_000)
    if ('clearAppBadge' in navigator) void navigator.clearAppBadge()
    return () => {
      state.closed = true
      clearTimeout(state.timer)
      if (state.ping) clearInterval(state.ping)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      state.socket?.close()
    }
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

  async function bodyText(id: string) {
    const cached = await mailStore.getBody<Attachment, SecurityDetails>(id)
    if (cached) return cached.textBody
    try {
      const response = await fetch(`/api/messages/${encodeURIComponent(id)}`)
      return response.ok ? (await response.json<MessageDetail>()).message.textBody : null
    } catch { return null }
  }

  async function respond(mode: 'reply' | 'forward') {
    const latest = conversation?.latest
    if (!latest) return
    const quoted = quoteForReply({ fromAddr: latest.fromAddr, createdAt: latest.createdAt, textBody: await bodyText(latest.id) }, i18n.locale)
    const subject = latest.subject ?? ''
    if (mode === 'reply') setComposer({ to: latest.direction === 'outbound' ? latest.toAddr : recipient(latest.fromAddr), subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, text: quoted, replyTo: latest.id })
    else setComposer({ subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`, text: quoted })
  }

  async function editDraft(message: Message) {
    setComposer({ id: message.id, to: message.toAddr, subject: message.subject ?? '', text: (await bodyText(message.id)) ?? '' })
  }

  function toggleExpanded(id: string) {
    setExpandedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
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
    count: threads.length,
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
                    const thread = threads[row.index]
                    const latest = thread.latest
                    const ids = thread.messages.map((message) => message.id)
                    const checked = ids.every((id) => selectedIds.includes(id))
                    const open = Boolean(selected && ids.includes(selected.id))
                    const names = [...new Set(thread.messages.map((message) => view === 'sent' || message.direction === 'outbound' ? i18n._('me') : senderParts(message.fromAddr).name))]
                    const who = view === 'sent' ? senderParts(latest.toAddr).name : names.join(', ')
                    return <ContextMenu key={thread.id}>
                      <ContextMenuTrigger asChild>
                        <div data-index={row.index} ref={rowVirtualizer.measureElement} style={{ transform: `translateY(${row.start}px)` }} className={cn('absolute inset-x-0 top-0 flex border-b border-l-4 border-l-transparent hover:bg-muted/70', thread.unread && 'border-l-primary bg-primary/10', open && 'bg-secondary')}><label className="grid w-11 shrink-0 place-items-center"><input type="checkbox" checked={checked} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)))} aria-label={i18n._('Select')} /></label><button type="button" onClick={() => selectMessage(latest)} className="grid min-w-0 flex-1 grid-cols-[1fr_auto] gap-2 p-4 pl-0 text-left"><span className="sr-only">{thread.unread ? i18n._('Unread') : i18n._('Read')}</span><span className="min-w-0"><span className={cn('flex items-center gap-1.5 text-sm', thread.unread ? 'font-semibold' : 'text-muted-foreground')}><span className="truncate">{who}</span>{thread.count > 1 && <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">{thread.count}</span>}{thread.starred && <Star className="size-3.5 shrink-0 fill-yellow-400 text-yellow-500" />}</span><span className={cn('mt-1 block truncate text-sm', thread.unread ? 'font-semibold' : 'text-muted-foreground')}>{latest.subject || i18n._('(No subject)')}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{latest.snippet}</span></span><span className={cn('text-xs', thread.unread ? 'font-semibold' : 'text-muted-foreground')}>{new Date(latest.createdAt).toLocaleDateString(i18n.locale)}</span></button></div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onSelect={() => mailStore.update(ids, { read: thread.unread })}>{thread.unread ? <><MailOpen /><Trans id="Mark read" /></> : <><Mail /><Trans id="Mark unread" /></>}</ContextMenuItem>
                        <ContextMenuItem onSelect={() => updateMessage(latest.id, { starred: !latest.starred })}><Star className={latest.starred ? 'fill-yellow-400 text-yellow-500' : ''} />{latest.starred ? <Trans id="Unstar" /> : <Trans id="Star" />}</ContextMenuItem>
                        <ContextMenuSeparator />
                        {['archived', 'spam', 'trash'].includes(latest.status)
                          ? <ContextMenuItem onSelect={() => mailStore.update(ids, { status: 'received' })}><Inbox /><Trans id="Move to inbox" /></ContextMenuItem>
                          : <ContextMenuItem onSelect={() => mailStore.update(ids, { status: 'archived' })}><Archive /><Trans id="Archive" /></ContextMenuItem>}
                        {latest.status !== 'spam' && <ContextMenuItem onSelect={() => mailStore.update(ids, { status: 'spam' })}><ShieldAlert /><Trans id="Mark as spam" /></ContextMenuItem>}
                        {latest.status !== 'trash' && <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => mailStore.update(ids, { status: 'trash' })}><Trash2 /><Trans id="Delete" /></ContextMenuItem>}
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
              {selected && conversation ? (
                <>
                  <div className="sticky top-0 z-10 flex min-h-16 items-center gap-0.5 border-b bg-background/95 px-2 backdrop-blur sm:gap-1 sm:px-3 md:px-5">
                    <Button variant="ghost" size="icon" onClick={() => setSelected(null)} aria-label={i18n._('Back to message list')} title={i18n._('Back to message list')}><ArrowLeft /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Star')} title={i18n._('Star')} onClick={() => updateMessage(conversation.latest.id, { starred: !conversation.latest.starred })}><Star className={conversation.starred ? 'fill-yellow-400 text-yellow-500' : ''} /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Archive')} title={i18n._('Archive')} onClick={() => mailStore.update(threadIds, { status: 'archived' })}><Archive /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Snooze one day')} title={i18n._('Snooze one day')} onClick={() => mailStore.update(threadIds, { snoozedUntil: new Date(Date.now() + 86_400_000).toISOString() })}><CalendarClock /></Button>
                    <Button variant="ghost" size="icon" aria-label={i18n._('Delete')} title={i18n._('Delete')} onClick={() => mailStore.update(threadIds, { status: 'trash' })}><Trash2 /></Button>
                    {selected.status === 'draft' ? <Button className="ml-auto" onClick={() => void editDraft(selected)}><Trans id="Edit draft" /></Button> : <><Button className="ml-auto" variant="outline" aria-label={i18n._('Reply')} title={i18n._('Reply')} onClick={() => void respond('reply')}><CornerUpLeft /><span className="hidden sm:inline"><Trans id="Reply" /></span></Button><Button variant="outline" aria-label={i18n._('Forward')} title={i18n._('Forward')} onClick={() => void respond('forward')}><Forward /><span className="hidden sm:inline"><Trans id="Forward" /></span></Button></>}
                  </div>
                <article className="mx-auto w-full min-w-0 max-w-6xl p-4 md:p-6 lg:px-8">
                  <h2 className="flex items-start gap-2 text-xl font-semibold break-words sm:text-2xl">{conversation.latest.subject || i18n._('(No subject)')}{conversation.count > 1 && <span className="mt-1.5 shrink-0 rounded-full bg-muted px-2 text-xs font-medium tabular-nums text-muted-foreground">{conversation.count}</span>}</h2>
                  <div className="mt-2 divide-y">
                    {conversation.messages.map((message) => <ThreadMessage key={message.id} message={message} expanded={expandedIds.has(message.id) || conversation.count === 1} single={conversation.count === 1} onToggle={() => toggleExpanded(message.id)} ownAddresses={mailboxes.map((mailbox) => mailbox.address)} />)}
                  </div>
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

/** One message inside a conversation: a compact row when collapsed, header + body when expanded. */
function ThreadMessage({ message, expanded, single, onToggle, ownAddresses }: { message: Message; expanded: boolean; single: boolean; onToggle: () => void; ownAddresses: Array<string> }) {
  const { i18n } = useLingui()
  const [body, setBody] = useState<CachedBody<Attachment, SecurityDetails> | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const from = senderParts(message.fromAddr)
  const isOwn = ownAddresses.includes(from.address) || message.direction === 'outbound'

  useEffect(() => {
    if (!expanded) return
    const guard = { cancelled: false }
    const isCancelled = () => guard.cancelled
    void (async () => {
      const cached = await mailStore.getBody<Attachment, SecurityDetails>(message.id)
      if (isCancelled()) return
      if (cached && message.status !== 'draft') setBody(cached)
      try {
        const response = await fetch(`/api/messages/${encodeURIComponent(message.id)}`)
        if (!response.ok || isCancelled()) return
        const detail = await response.json<MessageDetail>()
        if (isCancelled()) return
        const fresh = { id: message.id, textBody: detail.message.textBody, htmlBody: detail.message.htmlBody, attachments: detail.attachments, security: detail.security, cachedAt: Date.now() }
        setBody(fresh)
        if (message.status !== 'draft') void mailStore.putBody(fresh)
      } catch { /* offline: keep the cached body */ }
    })()
    if (!message.read) void mailStore.update([message.id], { read: true })
    return () => { guard.cancelled = true }
  }, [expanded, message.id, message.status, message.read])

  if (!expanded) {
    return <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 py-3 text-left hover:bg-muted/40" aria-expanded={false} aria-label={i18n._('Expand message')}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">{(isOwn ? i18n._('me') : from.name).charAt(0).toUpperCase() || '?'}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm', message.read ? 'text-muted-foreground' : 'font-semibold')}>{isOwn ? i18n._('me') : from.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{message.snippet}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{new Date(message.createdAt).toLocaleString(i18n.locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
    </button>
  }

  const loaded = body?.id === message.id
  const text = loaded ? splitQuotedText(body.textBody ?? '') : null
  return <div className="py-2">
    <MessageHeader message={message} security={loaded ? body.security : null} open={detailsOpen} onToggle={() => setDetailsOpen((value) => !value)} ownAddresses={ownAddresses} onCollapse={single ? undefined : onToggle} />
    {!loaded
      ? <div className="mt-6 grid place-items-center p-8 text-muted-foreground">{mailStore.offline ? <span className="flex items-center gap-2 text-sm"><CloudOff className="size-4" /><Trans id="This message is not available offline yet." /></span> : <LoaderCircle className="animate-spin" />}</div>
      : body.htmlBody
        ? <MessageFrame key={message.id} title={i18n._('Message content')} html={collapseQuotedHtml(resolveInlineImages(body.htmlBody, message.id, body.attachments))} />
        : <div className="mt-6 text-sm leading-7">
          <pre className="whitespace-pre-wrap break-words font-sans">{text?.visible || (text?.quoted ? '' : i18n._('This message has no plain-text body.'))}</pre>
          {text?.quoted && <details className="mt-3"><summary className="inline-block cursor-pointer list-none rounded-full bg-muted px-2.5 text-xs font-bold tracking-widest text-muted-foreground select-none">···</summary><pre className="mt-2 whitespace-pre-wrap break-words border-l-2 pl-3 font-sans text-muted-foreground">{text.quoted}</pre></details>}
        </div>}
    {loaded && body.attachments.length > 0 && <div className="mt-6 flex flex-wrap gap-2">{body.attachments.map((attachment) => <a key={attachment.id} className="rounded-md border px-3 py-2 text-sm hover:bg-muted" href={`/api/messages/${message.id}/attachments/${attachment.id}`}>{attachment.filename} · {(attachment.size / 1024).toFixed(0)} KB</a>)}</div>}
  </div>
}

function MessageHeader({ message, security, open, onToggle, ownAddresses, onCollapse }: { message: Message; security: SecurityDetails | null; open: boolean; onToggle: () => void; ownAddresses: Array<string>; onCollapse?: () => void }) {
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
            {onCollapse && <button type="button" onClick={onCollapse} className="-mr-1 grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={i18n._('Collapse message')} title={i18n._('Collapse message')}><ChevronUp className="size-4" /></button>}
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

/** Renders the HTML body in a sandboxed iframe that grows with its content, including late-loading images. */
function MessageFrame({ title, html }: { title: string; html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    let observer: ResizeObserver | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const fit = () => {
      const doc = frame.contentDocument
      if (!doc) return
      const height = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 200)
      frame.style.height = `${height}px`
    }
    const attach = () => {
      const doc = frame.contentDocument
      if (!doc) return
      fit()
      observer = new ResizeObserver(fit)
      observer.observe(doc.documentElement)
      observer.observe(doc.body)
      for (const image of Array.from(doc.images)) image.addEventListener('load', fit, { once: true })
      // Fonts and lazy layout can settle after load; re-measure a few times.
      let runs = 0
      const tick = () => { fit(); if (runs++ < 5) timer = setTimeout(tick, 400) }
      tick()
    }
    frame.addEventListener('load', attach)
    if (frame.contentDocument?.readyState === 'complete' && frame.contentDocument.body.childElementCount) attach()
    return () => {
      frame.removeEventListener('load', attach)
      observer?.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [html])
  return <iframe
    ref={ref}
    title={title}
    sandbox="allow-same-origin"
    referrerPolicy="no-referrer"
    scrolling="no"
    className="mt-6 block w-[calc(100%+2rem)] max-w-none -mx-4 min-h-48 border-0 bg-white sm:mx-0 sm:w-full md:mt-8"
    srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;max-width:100%;overflow-x:hidden;word-break:break-word}img,table{max-width:100%!important;height:auto}${QUOTE_STYLE}</style>${html}`}
  />
}
