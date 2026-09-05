import { describe, expect, test } from 'bun:test'
import { collapseQuotedHtml, splitQuotedText } from './quote'

describe('collapseQuotedHtml', () => {
  test('wraps a gmail quote in a collapsed details block', () => {
    const html = '<div dir="ltr">YOLO</div><br><div class="gmail_quote"><div>Svetch ezt írta:</div><blockquote>Yolo</blockquote></div>'
    const out = collapseQuotedHtml(html)
    expect(out.startsWith('<div dir="ltr">YOLO</div><br><details class="qm-quote"><summary>')).toBe(true)
    expect(out.endsWith('</blockquote></div></details>')).toBe(true)
  })
  test('keeps the body tail outside the details and ignores leading quotes', () => {
    expect(collapseQuotedHtml('<blockquote>only quote</blockquote>')).toBe('<blockquote>only quote</blockquote>')
    const out = collapseQuotedHtml('<html><body><p>Hello there, this is a fresh reply.</p><blockquote type="cite">old</blockquote></body></html>')
    expect(out).toContain('</details></body></html>')
  })
})

describe('splitQuotedText', () => {
  test('splits at the attribution line', () => {
    const { visible, quoted } = splitQuotedText('YOLOOOOO\n\nSvetch <a@b.c> ezt írta (időpont: 2026. szept. 5.):\n> Yolo\n>\n> earlier')
    expect(visible).toBe('YOLOOOOO')
    expect(quoted?.startsWith('Svetch')).toBe(true)
  })
  test('leaves text without quotes alone', () => {
    expect(splitQuotedText('Hi\nthere').quoted).toBeNull()
  })
})
