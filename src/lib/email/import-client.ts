import { splitMboxMessages } from './mbox'

// ponytail: small batches trade request count for staying below Workers CPU and memory ceilings.
const MAX_BATCH_BYTES = 5 * 1024 * 1024
const MAX_BATCH_MESSAGES = 20
const MAX_MESSAGE_BYTES = 24 * 1024 * 1024

function isMbox(file: File) {
  const name = file.name.toLowerCase()
  return name.endsWith('.mbox') || name.endsWith('.mbx') || file.type === 'application/mbox'
}

export async function createImportBatches(files: File[]) {
  const messages: File[] = []
  for (const file of files) {
    if (!isMbox(file)) {
      messages.push(file)
      continue
    }
    for (const [index, raw] of splitMboxMessages(await file.text()).entries()) {
      messages.push(new File([raw], `${file.name}#${index + 1}.eml`, { type: 'message/rfc822' }))
    }
  }

  const batches: File[][] = []
  let batch: File[] = []
  let batchBytes = 0
  for (const message of messages) {
    if (message.size > MAX_MESSAGE_BYTES) throw new Error(`${message.name} exceeds the 24 MiB import limit`)
    if (batch.length && (batch.length === MAX_BATCH_MESSAGES || batchBytes + message.size > MAX_BATCH_BYTES)) {
      batches.push(batch)
      batch = []
      batchBytes = 0
    }
    batch.push(message)
    batchBytes += message.size
  }
  if (batch.length) batches.push(batch)
  return batches
}
