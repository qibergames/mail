import { describe, expect, test } from 'bun:test'
import { assertSafeImapHost, listName, quoteImap, searchUids } from './imap'

describe('IMAP protocol helpers', () => {
  test('quotes credentials and parses server responses', () => {
    expect(quoteImap('a"b\\c')).toBe('"a\\"b\\\\c"')
    expect(searchUids('* SEARCH 1 20 x')).toEqual(['1', '20'])
    expect(listName('* LIST (\\HasNoChildren) "/" "Sent Items"')).toBe('Sent Items')
  })
  test('rejects local and private hosts', () => {
    for (const host of ['localhost', 'mail.local', '127.0.0.1', '10.0.0.1', '192.168.1.2', '::1']) expect(() => assertSafeImapHost(host)).toThrow()
    expect(() => assertSafeImapHost('imap.example.com')).not.toThrow()
  })
})
