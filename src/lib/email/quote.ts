/** Collapses quoted earlier messages the way mail clients do, so a thread reads as one message per bubble. */

const HTML_QUOTE_MARKERS = [
  /<div[^>]*class="[^"]*\bgmail_quote\b[^"]*"[^>]*>/i,
  /<blockquote[^>]*type="cite"[^>]*>/i,
  /<div[^>]*class="[^"]*\b(?:yahoo_quoted|moz-cite-prefix|protonmail_quote)\b[^"]*"[^>]*>/i,
  /<div[^>]*id="(?:divRplyFwdMsg|appendonsend|isForwardContent)"[^>]*>/i,
  /<hr[^>]*id="stopSpelling"[^>]*>/i,
  /-----\s*Original Message\s*-----/i,
  /<blockquote(?![^>]*class="[^"]*\bnot-quote)/i,
]

const TEXT_ATTRIBUTION = /^(?:>|On .+ wrote:?$|.+ (?:ezt írta|írta \(időpont)|.+ wrote:$|Am .+ schrieb .+:$|Le .+ a écrit\s*:$|-{2,}\s*(?:Original Message|Eredeti üzenet|Forwarded message|Továbbított üzenet)\s*-{2,}|From:\s.+|Feladó:\s.+)/i

export const QUOTE_STYLE = 'details.qm-quote{margin:14px 0 0}details.qm-quote>summary{list-style:none;display:inline-block;cursor:pointer;padding:0 10px;line-height:18px;border-radius:9px;background:#e2e5ea;color:#4b5563;font:bold 13px/18px system-ui,sans-serif;letter-spacing:2px;user-select:none}details.qm-quote>summary::-webkit-details-marker{display:none}details.qm-quote[open]>summary{margin-bottom:10px}'

/** Wraps the first recognised quote block (and everything after it) in a collapsed <details>. */
export function collapseQuotedHtml(html: string) {
  let best: { index: number } | null = null
  for (const marker of HTML_QUOTE_MARKERS) {
    const match = marker.exec(html)
    if (match && (best === null || match.index < best.index)) best = { index: match.index }
  }
  if (!best) return html
  // Nothing but the quote: leave it visible.
  if (!html.slice(0, best.index).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()) return html
  const tailStart = html.search(/<\/body>|<\/html>/i)
  const end = tailStart === -1 ? html.length : tailStart
  if (best.index >= end) return html
  return `${html.slice(0, best.index)}<details class="qm-quote"><summary>···</summary>${html.slice(best.index, end)}</details>${html.slice(end)}`
}

/** Splits plain text into the fresh part and the quoted tail (attribution line plus > lines). */
export function splitQuotedText(text: string): { visible: string; quoted: string | null } {
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (TEXT_ATTRIBUTION.test(line)) {
      // An attribution line must be followed by quoted content to count.
      const rest = lines.slice(index + 1).join('\n').trim()
      if (rest || line.startsWith('>')) { start = index; break }
    }
  }
  if (start <= 0) return { visible: text, quoted: null }
  return { visible: lines.slice(0, start).join('\n').replace(/\s+$/, ''), quoted: lines.slice(start).join('\n') }
}

/** Builds the quoted block appended to a reply. */
export function quoteForReply(message: { fromAddr: string; createdAt: string; textBody: string | null }, locale: string) {
  const when = new Date(message.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const body = (message.textBody ?? '').replace(/\s+$/, '')
  return `\n\n${when} ${message.fromAddr}:\n${body.split('\n').map((line) => `> ${line}`).join('\n')}`
}
