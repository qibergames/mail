import { expect, test } from 'bun:test'
import { decodeEntities, resolveInlineImages, snippetFrom, textFromHtml } from './html'

test('decodes numeric, hex and common named entities and leaves unknown ones alone', () => {
  expect(decodeEntities('leford&#237;tja &#x151;szel &amp; &nbsp;k&ouml;zel &#0;')).toBe('lefordítja őszel &  k&ouml;zel &#0;')
})

test('HTML text drops markup and styles and decodes entities', () => {
  expect(textFromHtml('<style>p{color:red}</style><p>Az &#214;N</p><p>P&#193;RN&#193;JA</p>')).toBe('Az ÖN PÁRNÁJA')
})

test('snippets decode entities in the text part and drop invisible preheader padding', () => {
  expect(snippetFrom('\r\n  Az Enence azonnal leford&#237;tja\r\n a besz&#233;lget&#233;seket.', '<p>ignored</p>')).toBe('Az Enence azonnal lefordítja a beszélgetéseket.')
  expect(snippetFrom('Valid for 10 minutes \u034f \u034f \u200c', null)).toBe('Valid for 10 minutes')
  expect(snippetFrom('  ', '<b>Hi</b> there')).toBe('Hi there')
  expect(snippetFrom('x'.repeat(300), null)).toHaveLength(200)
})

test('inline CID images use the authenticated attachment preview', () => {
  expect(resolveInlineImages('<img src="cid:logo@example.com">', 'message 1', [
    { id: 'attachment 1', contentId: '<logo@example.com>' },
  ])).toBe('<img src="/api/messages/message%201/attachments/attachment%201?preview=1">')
})
