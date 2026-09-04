import type { MailView } from '@/components/mail-app'

export type MessageSummary = {
  id: string
  mailboxId: string | null
  direction: 'inbound' | 'outbound'
  folderId: string | null
  fromAddr: string
  toAddr: string
  subject: string | null
  snippet: string | null
  status: string
  read: boolean
  starred: boolean
  snoozedUntil: string | null
  threadId: string | null
  createdAt: string
  updatedAt: string
}

export type CachedBody<TAttachment, TSecurity> = { id: string; textBody: string | null; htmlBody: string | null; attachments: Array<TAttachment>; security: TSecurity | null; cachedAt: number }
export type MessageChanges = { read?: boolean; starred?: boolean; status?: string; snoozedUntil?: string | null }

type SyncPayload = { now: number; messages: Array<MessageSummary>; deleted: Array<string>; full: boolean; truncated: boolean; mailboxIds: Array<string> }
type OutboxEntry = { key?: number; ids: Array<string>; changes: MessageChanges; createdAt: number }

const DB_NAME = 'qibermail'
const DB_VERSION = 1

function openDatabase() {
  return new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'id' }).createIndex('mailboxId', 'mailboxId')
      if (!db.objectStoreNames.contains('bodies')) db.createObjectStore('bodies', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key', autoIncrement: true })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

class MailStore {
  private messages = new Map<string, MessageSummary>()
  private listeners = new Set<() => void>()
  private database: Promise<IDBDatabase | null> | null = null
  private cursor: number | null = null
  private syncPromise: Promise<void> | null = null
  private flushing = false
  private started = false
  private viewCache = new Map<string, { version: number; rows: Array<MessageSummary> }>()
  version = 0
  ready = false
  syncing = false
  offline = false
  lastSyncedAt: number | null = null

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getVersion = () => this.version

  private emit() {
    this.version += 1
    for (const listener of this.listeners) listener()
  }

  private db() {
    this.database ??= openDatabase()
    return this.database
  }

  /** Loads the local cache, then pulls a delta from the server. Safe to call repeatedly. */
  async start() {
    if (this.started) return this.sync()
    this.started = true
    const db = await this.db()
    if (db) {
      try {
        const transaction = db.transaction(['messages', 'meta'], 'readonly')
        const rows = await requestToPromise(transaction.objectStore('messages').getAll() as IDBRequest<Array<MessageSummary>>)
        const meta = await requestToPromise(transaction.objectStore('meta').get('cursor') as IDBRequest<{ key: string; value: number } | undefined>)
        for (const row of rows) this.messages.set(row.id, row)
        this.cursor = meta?.value ?? null
      } catch (error) {
        console.warn('Mail cache unavailable', error)
      }
    }
    this.ready = true
    this.emit()
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { this.offline = false; this.emit(); void this.flushOutbox().then(() => this.sync()) })
      window.addEventListener('offline', () => { this.offline = true; this.emit() })
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.sync() })
      this.offline = !navigator.onLine
    }
    await this.flushOutbox()
    await this.sync()
  }

  get(id: string) {
    return this.messages.get(id) ?? null
  }

  async sync() {
    if (this.syncPromise) return this.syncPromise
    this.syncPromise = this.runSync().finally(() => { this.syncPromise = null })
    return this.syncPromise
  }

  private async runSync() {
    if (typeof fetch === 'undefined') return
    this.syncing = true
    this.emit()
    try {
      const response = await fetch(`/api/messages/sync${this.cursor ? `?since=${this.cursor}` : ''}`)
      if (!response.ok) return
      const payload = await response.json<SyncPayload>()
      const accessible = new Set(payload.mailboxIds)
      const removed: Array<string> = []
      if (payload.full) {
        for (const [id, row] of this.messages) if (!row.mailboxId || !accessible.has(row.mailboxId)) { this.messages.delete(id); removed.push(id) }
      }
      for (const id of payload.deleted) if (this.messages.delete(id)) removed.push(id)
      const changed: Array<MessageSummary> = []
      for (const row of payload.messages) {
        const current = this.messages.get(row.id)
        if (current && current.updatedAt > row.updatedAt) continue
        this.messages.set(row.id, row)
        changed.push(row)
      }
      this.cursor = payload.now
      this.lastSyncedAt = Date.now()
      this.offline = false
      this.viewCache.clear()
      await this.persist(changed, removed)
      if (payload.truncated && !payload.full) void this.sync()
    } catch (error) {
      this.offline = typeof navigator !== 'undefined' && !navigator.onLine
      console.warn('Mail sync failed', error)
    } finally {
      this.syncing = false
      this.emit()
    }
  }

  private async persist(changed: Array<MessageSummary>, removed: Array<string>) {
    const db = await this.db()
    if (!db) return
    try {
      const transaction = db.transaction(['messages', 'meta'], 'readwrite')
      const store = transaction.objectStore('messages')
      for (const row of changed) store.put(row)
      for (const id of removed) store.delete(id)
      transaction.objectStore('meta').put({ key: 'cursor', value: this.cursor })
      await transactionDone(transaction)
    } catch (error) {
      console.warn('Mail cache write failed', error)
    }
  }

  /** Applies a change locally right away and queues it for the server. */
  async update(ids: Array<string>, changes: MessageChanges) {
    const now = new Date().toISOString()
    const changed: Array<MessageSummary> = []
    for (const id of ids) {
      const current = this.messages.get(id)
      if (!current) continue
      const next: MessageSummary = { ...current, ...('read' in changes ? { read: changes.read! } : {}), ...('starred' in changes ? { starred: changes.starred! } : {}), ...(changes.status ? { status: changes.status } : {}), ...(changes.snoozedUntil !== undefined ? { snoozedUntil: changes.snoozedUntil } : {}), updatedAt: now }
      this.messages.set(id, next)
      changed.push(next)
    }
    this.viewCache.clear()
    this.emit()
    await this.persist(changed, [])
    await this.enqueue({ ids, changes, createdAt: Date.now() })
    await this.flushOutbox()
  }

  private async enqueue(entry: OutboxEntry) {
    const db = await this.db()
    if (!db) { this.memoryOutbox.push(entry); return }
    try {
      const transaction = db.transaction('outbox', 'readwrite')
      transaction.objectStore('outbox').add(entry)
      await transactionDone(transaction)
    } catch {
      this.memoryOutbox.push(entry)
    }
  }

  private memoryOutbox: Array<OutboxEntry> = []

  async flushOutbox() {
    if (this.flushing || typeof fetch === 'undefined') return
    this.flushing = true
    try {
      const db = await this.db()
      const entries: Array<OutboxEntry> = db ? await requestToPromise(db.transaction('outbox', 'readonly').objectStore('outbox').getAll() as IDBRequest<Array<OutboxEntry>>).catch(() => []) : []
      const queue = [...entries, ...this.memoryOutbox]
      for (const entry of queue) {
        const sent = await this.send(entry)
        if (!sent) { this.offline = true; this.emit(); return }
        if (entry.key !== undefined && db) {
          const transaction = db.transaction('outbox', 'readwrite')
          transaction.objectStore('outbox').delete(entry.key)
          await transactionDone(transaction).catch(() => undefined)
        } else {
          this.memoryOutbox = this.memoryOutbox.filter((item) => item !== entry)
        }
      }
    } finally {
      this.flushing = false
    }
  }

  private async send(entry: OutboxEntry) {
    try {
      const response = entry.ids.length === 1
        ? await fetch(`/api/messages/${entry.ids[0]}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry.changes) })
        : await fetch('/api/messages/bulk', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: entry.ids, ...entry.changes }) })
      // 4xx means the server rejected it for good (e.g. message gone); drop rather than retry forever.
      return response.ok || (response.status >= 400 && response.status < 500)
    } catch {
      return false
    }
  }

  /** Messages for a view, mirroring the server-side filters in /api/messages. */
  select(view: MailView, mailboxId: string, folderId?: string) {
    const key = `${view}:${mailboxId}:${folderId ?? ''}`
    const cached = this.viewCache.get(key)
    if (cached && cached.version === this.version) return cached.rows
    const now = new Date().toISOString()
    const rows: Array<MessageSummary> = []
    for (const message of this.messages.values()) {
      if (message.mailboxId !== mailboxId) continue
      if (!matchesView(message, view, folderId, now)) continue
      rows.push(message)
    }
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    this.viewCache.set(key, { version: this.version, rows })
    return rows
  }

  async getBody<TAttachment, TSecurity>(id: string): Promise<CachedBody<TAttachment, TSecurity> | null> {
    const db = await this.db()
    if (!db) return null
    try {
      return (await requestToPromise(db.transaction('bodies', 'readonly').objectStore('bodies').get(id) as IDBRequest<CachedBody<TAttachment, TSecurity> | undefined>)) ?? null
    } catch {
      return null
    }
  }

  async putBody<TAttachment, TSecurity>(body: CachedBody<TAttachment, TSecurity>) {
    const db = await this.db()
    if (!db) return
    try {
      const transaction = db.transaction('bodies', 'readwrite')
      transaction.objectStore('bodies').put(body)
      await transactionDone(transaction)
    } catch (error) {
      console.warn('Body cache write failed', error)
    }
  }

  async hasBody(id: string) {
    const db = await this.db()
    if (!db) return false
    try {
      return Boolean(await requestToPromise(db.transaction('bodies', 'readonly').objectStore('bodies').getKey(id)))
    } catch {
      return false
    }
  }

  async readMeta<T>(key: string): Promise<T | null> {
    const db = await this.db()
    if (!db) return null
    try {
      const row = await requestToPromise(db.transaction('meta', 'readonly').objectStore('meta').get(key) as IDBRequest<{ key: string; value: T } | undefined>)
      return row?.value ?? null
    } catch {
      return null
    }
  }

  async writeMeta<T>(key: string, value: T) {
    const db = await this.db()
    if (!db) return
    try {
      const transaction = db.transaction('meta', 'readwrite')
      transaction.objectStore('meta').put({ key, value })
      await transactionDone(transaction)
    } catch { /* cache only */ }
  }
}

export function matchesView(message: MessageSummary, view: MailView, folderId: string | undefined, now: string) {
  if (view === 'sent') return message.direction === 'outbound' && ['queued', 'scheduled', 'sent', 'failed'].includes(message.status)
  if (view === 'drafts') return message.status === 'draft'
  if (view === 'starred') return message.starred
  if (view === 'snoozed') return Boolean(message.snoozedUntil && message.snoozedUntil > now)
  if (view === 'archived' || view === 'spam' || view === 'trash') return message.status === view
  if (folderId) return message.folderId === folderId
  return message.status === 'received' && (!message.snoozedUntil || message.snoozedUntil <= now)
}

export const mailStore = new MailStore()
