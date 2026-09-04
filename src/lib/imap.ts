import type { connect as connectSocket } from 'cloudflare:sockets'

type Connect = typeof connectSocket

export type ImapInput = { host: string; port: number; username: string; password: string; folder: string; limit: number }

export function assertSafeImapHost(raw: string) {
  const host = raw.trim().toLowerCase()
  if (!host || host.length > 253 || host === 'localhost' || host.endsWith('.local') || host === '::1' || /^(?:fc|fd|fe8|fe9|fea|feb)/.test(host)) throw new Error('IMAP host is not allowed')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) throw new Error('IMAP host is not allowed')
  }
}
export function quoteImap(value: string) { return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` }
export function searchUids(line: string) { return line.match(/^\* SEARCH(?:\s+(.+))?$/i)?.[1]?.trim().split(/\s+/).filter((value) => /^\d+$/.test(value)) ?? [] }
export function listName(line: string) { const raw = line.match(/^\* LIST\s+\([^)]*\)\s+(?:"[^"]*"|NIL)\s+(.+)$/i)?.[1]?.trim(); return raw?.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : raw || null }

class Imap {
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private writer: WritableStreamDefaultWriter<Uint8Array>
  private buffer = new Uint8Array()
  private tag = 0
  constructor(socket: Socket) { this.reader = socket.readable.getReader(); this.writer = socket.writable.getWriter() }
  async close() { await this.writer.close().catch(() => undefined) }
  async line() {
    for (;;) {
      for (let index = 0; index < this.buffer.length - 1; index += 1) if (this.buffer[index] === 13 && this.buffer[index + 1] === 10) { const value = new TextDecoder().decode(this.buffer.slice(0, index)); this.buffer = this.buffer.slice(index + 2); return value }
      const { value, done } = await this.reader.read(); if (done) throw new Error('IMAP connection closed')
      const next = new Uint8Array(this.buffer.length + value.length); next.set(this.buffer); next.set(value, this.buffer.length); this.buffer = next
    }
  }
  async bytes(length: number) { if (length > 25 * 1024 * 1024) throw new Error('IMAP message exceeds 25 MB'); while (this.buffer.length < length) { const { value, done } = await this.reader.read(); if (done) throw new Error('IMAP connection closed'); const next = new Uint8Array(this.buffer.length + value.length); next.set(this.buffer); next.set(value, this.buffer.length); this.buffer = next } const value = this.buffer.slice(0, length); this.buffer = this.buffer.slice(length); return value.buffer }
  async command(command: string) { const tag = `A${String(++this.tag).padStart(4, '0')}`; await this.writer.write(new TextEncoder().encode(`${tag} ${command}\r\n`)); const lines: Array<string> = []; for (;;) { const line = await this.line(); lines.push(line); if (line.toUpperCase().startsWith(`${tag} `)) { if (!line.toUpperCase().includes(' OK')) throw new Error(`IMAP command failed: ${line}`); return lines } } }
  async fetch(uid: string) { const tag = `A${String(++this.tag).padStart(4, '0')}`; await this.writer.write(new TextEncoder().encode(`${tag} UID FETCH ${uid} (RFC822)\r\n`)); let raw: ArrayBuffer | null = null; for (;;) { const line = await this.line(); const length = Number(line.match(/\{(\d+)\}$/)?.[1]); if (Number.isFinite(length)) { raw = await this.bytes(length); continue } if (line.toUpperCase().startsWith(`${tag} `)) { if (!line.toUpperCase().includes(' OK')) throw new Error(`IMAP fetch failed: ${line}`); if (raw === null) throw new Error('IMAP fetch returned no message'); return raw } } }
}

async function connectImap(input: Omit<ImapInput, 'folder' | 'limit'>) {
  assertSafeImapHost(input.host)
  const moduleName = 'cloudflare:sockets'; const { connect } = await import(/* @vite-ignore */ moduleName) as { connect: Connect }
  const imap = new Imap(connect({ hostname: input.host, port: input.port }, { secureTransport: 'on', allowHalfOpen: false }))
  const greeting = await imap.line(); if (!greeting.startsWith('* OK')) { await imap.close(); throw new Error('IMAP server rejected the connection') }
  await imap.command(`LOGIN ${quoteImap(input.username)} ${quoteImap(input.password)}`)
  return imap
}

export async function fetchImapMessages(input: ImapInput) {
  const imap = await connectImap(input)
  try { await imap.command(`SELECT ${quoteImap(input.folder)}`); const uids = (await imap.command('UID SEARCH ALL')).flatMap(searchUids).slice(-input.limit); const files = []; for (const uid of uids) files.push({ name: `${input.folder}-${uid}.eml`, content: await imap.fetch(uid) }); await imap.command('LOGOUT').catch(() => undefined); return files } finally { await imap.close() }
}

export async function listImapFolders(input: Omit<ImapInput, 'folder' | 'limit'>) {
  const imap = await connectImap(input)
  try { const folders = (await imap.command('LIST "" "*"')).map(listName).filter((name): name is string => Boolean(name)); await imap.command('LOGOUT').catch(() => undefined); return [...new Set(folders)] } finally { await imap.close() }
}
