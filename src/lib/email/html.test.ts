import { expect, test } from 'bun:test'
import { resolveInlineImages } from './html'

test('inline CID images use the authenticated attachment preview', () => {
  expect(resolveInlineImages('<img src="cid:logo@example.com">', 'message 1', [
    { id: 'attachment 1', contentId: '<logo@example.com>' },
  ])).toBe('<img src="/api/messages/message%201/attachments/attachment%201?preview=1">')
})
