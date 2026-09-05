import { describe, expect, test } from 'bun:test'
import { createPushPayload } from './push-payload'

describe('push privacy', () => {
  test('contains only notification routing metadata, sender and subject', () => {
    const payload = createPushPayload('hu', { id: 'msg/1', from: 'Ada <ada@example.com>', subject: 'Hello' }, 3)
    expect(payload).toEqual({ title: 'Új levél', body: 'Ada <ada@example.com>\nHello', tag: 'message-msg/1', url: '/inbox?message=msg%2F1', messageId: 'msg/1', mailboxId: null, unread: 3 })
    expect(JSON.stringify(payload)).not.toContain('snippet')
  })

  test('localizes a missing subject', () => {
    expect(createPushPayload('en', { id: '1', from: 'a@example.com' }, 1).body).toBe('a@example.com\n(No subject)')
  })
})
