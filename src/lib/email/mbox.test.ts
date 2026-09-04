import { describe, expect, test } from 'bun:test'
import { createImportBatches } from './import-client'
import { splitMboxMessages } from './mbox'

const message = (id: number) => `From sender@example.com Sat Jan 01 00:00:00 2026\r\nMessage-ID: <${id}@example.com>\r\n\r\nMessage ${id}\r\n>From escaped body\r\n`

describe('MBOX import', () => {
  test('splits messages and unescapes body From lines', () => {
    const messages = splitMboxMessages(message(1) + message(2))
    expect(messages).toHaveLength(2)
    expect(messages[0]).toContain('\nFrom escaped body')
  })

  test('creates small upload batches', async () => {
    const file = new File([Array.from({ length: 41 }, (_, index) => message(index)).join('')], 'takeout.mbox')
    expect((await createImportBatches([file])).map((batch) => batch.length)).toEqual([20, 20, 1])
  })
})
