/** Conversation grouping shared by the server (header-based) and the client (header + subject fallback). */

const SUBJECT_PREFIX = /^\s*(?:(?:re|fw|fwd|aw|wg|sv|vs|vá|válasz|tov)\s*(?:\[\d+\])?\s*:\s*)+/i

export function normalizeSubject(subject: string | null | undefined) {
  return (subject ?? '').replace(SUBJECT_PREFIX, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Message-ID values as they appear in Message-ID / In-Reply-To / References headers, without angle brackets. */
export function parseMessageIds(value: string | null | undefined) {
  return (value ?? '').split(/\s+/).map((item) => item.trim().replace(/^<|>$/g, '')).filter(Boolean)
}

export function addressesIn(value: string | null | undefined) {
  return [...(value ?? '').matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0].toLowerCase())
}

type Threadable = { id: string; threadId: string | null; subject: string | null; fromAddr: string; toAddr: string; createdAt: string; read: boolean; starred: boolean }

export type Thread<T extends Threadable> = { id: string; messages: Array<T>; latest: T; count: number; unread: boolean; starred: boolean; participants: Array<string> }

/**
 * Groups messages into conversations: first by the threadId assigned from mail headers, then merges groups
 * that share a normalized subject and at least one participant address (covers mail without References).
 */
export function groupThreads<T extends Threadable>(messages: Array<T>): Array<Thread<T>> {
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    const next = parent.get(key)
    if (!next || next === key) { parent.set(key, key); return key }
    const root = find(next)
    parent.set(key, root)
    return root
  }
  const union = (a: string, b: string) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rb, ra) }

  const keyOf = (message: T) => message.threadId || message.id
  for (const message of messages) find(keyOf(message))

  const bySubject = new Map<string, Array<{ key: string; addresses: Set<string> }>>()
  for (const message of messages) {
    const subject = normalizeSubject(message.subject)
    if (!subject) continue
    const addresses = new Set([...addressesIn(message.fromAddr), ...addressesIn(message.toAddr)])
    const bucket = bySubject.get(subject) ?? []
    for (const other of bucket) {
      if ([...addresses].some((address) => other.addresses.has(address))) union(other.key, keyOf(message))
    }
    bucket.push({ key: keyOf(message), addresses })
    bySubject.set(subject, bucket)
  }

  const groups = new Map<string, Array<T>>()
  for (const message of messages) {
    const root = find(keyOf(message))
    const group = groups.get(root) ?? []
    group.push(message)
    groups.set(root, group)
  }

  const threads: Array<Thread<T>> = []
  for (const group of groups.values()) {
    group.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    const latest = group[group.length - 1]
    const participants = [...new Set(group.flatMap((message) => addressesIn(message.fromAddr)))]
    threads.push({ id: group[0].threadId || group[0].id, messages: group, latest, count: group.length, unread: group.some((message) => !message.read), starred: group.some((message) => message.starred), participants })
  }
  threads.sort((a, b) => (a.latest.createdAt < b.latest.createdAt ? 1 : a.latest.createdAt > b.latest.createdAt ? -1 : 0))
  return threads
}
