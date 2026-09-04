import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { requireSession } from '@/lib/api-auth'
import { importRawEmails } from '@/lib/email/import'
import type { RawEmail } from '@/lib/email/import'
import { splitMboxMessages } from '@/lib/email/mbox'

const MAX_REQUEST_BYTES = 25 * 1024 * 1024
const MAX_MESSAGE_BYTES = 24 * 1024 * 1024
const MAX_MESSAGES = 100

function isMbox(file: File) {
  const name = file.name.toLowerCase()
  return name.endsWith('.mbox') || name.endsWith('.mbx') || file.type === 'application/mbox'
}

function isEml(file: File) {
  return file.name.toLowerCase().endsWith('.eml') || file.type === 'message/rfc822' || !file.type
}

function encode(value: string) {
  const bytes = new TextEncoder().encode(value)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

export const Route = createFileRoute('/api/import')({ server: { handlers: { POST: async ({ request }) => {
  const session = await requireSession(request)
  if (Number(request.headers.get('content-length') ?? 0) > MAX_REQUEST_BYTES) return Response.json({ error: 'Import upload exceeds the 25 MiB limit' }, { status: 413 })

  const form = await request.formData().catch(() => null)
  if (!form) return Response.json({ error: 'Invalid import upload' }, { status: 400 })
  const mailboxId = String(form.get('mailboxId') ?? '')
  const files = form.getAll('files').filter((value): value is File => value instanceof File && value.size > 0)
  if (!mailboxId || !files.length || files.some((file) => !isMbox(file) && !isEml(file))) {
    return Response.json({ error: 'Select a mailbox and at least one .eml or .mbox file' }, { status: 400 })
  }
  if (files.reduce((size, file) => size + file.size, 0) > MAX_REQUEST_BYTES || files.some((file) => file.size > MAX_MESSAGE_BYTES)) {
    return Response.json({ error: 'Import upload exceeds the 25 MiB limit' }, { status: 413 })
  }

  const messages: RawEmail[] = []
  for (const file of files) {
    if (isMbox(file)) {
      splitMboxMessages(await file.text()).forEach((content, index) => messages.push({ name: `${file.name}#${index + 1}.eml`, content: encode(content) }))
    } else {
      messages.push({ name: file.name, content: await file.arrayBuffer() })
    }
  }
  if (!messages.length || messages.length > MAX_MESSAGES) return Response.json({ error: 'Import batches must contain 1–100 messages' }, { status: 400 })

  const result = await importRawEmails(env, session.user.id, mailboxId, messages)
  return Response.json({ imported: result.ids.length, ...result })
} } } })
