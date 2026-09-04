import { eq } from 'drizzle-orm'
import { getDb } from '@/db'
import { messageAttachments } from '@/db/schema'
import { newId } from '@/lib/ids'

export type Attachment = {
  filename: string
  type: string
  content: ArrayBuffer
  disposition?: 'attachment' | 'inline'
  contentId?: string | null
}

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_SIZE = 20 * 1024 * 1024

export function validateAttachments(attachments: Array<Attachment>) {
  if (attachments.length > 10) throw new Error('A message can include at most 10 attachments')
  if (attachments.some((item) => item.content.byteLength > MAX_ATTACHMENT_SIZE)) throw new Error('An attachment exceeds 10 MB')
  if (attachments.reduce((sum, item) => sum + item.content.byteLength, 0) > MAX_TOTAL_ATTACHMENT_SIZE) {
    throw new Error('Attachments exceed 20 MB')
  }
}

export async function storeAttachments(env: CloudflareEnv, messageId: string, attachments: Array<Attachment>) {
  validateAttachments(attachments)
  const stored: Array<string> = []
  try {
    for (const attachment of attachments) {
      const id = newId('att')
      const filename = attachment.filename.trim().replace(/[/\\\0]/g, '_') || 'attachment'
      const key = `attachments/${messageId}/${id}/${filename}`
      await env.BUCKET.put(key, attachment.content, {
        httpMetadata: { contentType: attachment.type },
        customMetadata: { filename, messageId },
      })
      stored.push(key)
      await getDb(env.DB).insert(messageAttachments).values({
        id,
        messageId,
        filename,
        contentType: attachment.type,
        size: attachment.content.byteLength,
        disposition: attachment.disposition ?? 'attachment',
        contentId: attachment.contentId ?? null,
        r2Key: key,
      })
    }
  } catch (error) {
    await Promise.all(stored.map((key) => env.BUCKET.delete(key)))
    throw error
  }
}

export function listAttachments(messageId: string) {
  return getDb().select().from(messageAttachments).where(eq(messageAttachments.messageId, messageId))
}
