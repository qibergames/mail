export type SecurityDetails = {
  date: string | null
  mailedBy: string | null
  signedBy: string | null
  spf: string | null
  dkim: string | null
  dmarc: string | null
  /** 'unknown' when no Received header records the transport (Cloudflare Email Routing does not). */
  encryption: 'tls' | 'none' | 'unknown'
}

type Header = { key: string; value: string }

function domainOf(value: string) {
  const at = value.lastIndexOf('@')
  return (at === -1 ? value : value.slice(at + 1)).replace(/[>;)\s]+$/, '').toLowerCase() || null
}

// Cloudflare Email Routing prepends its own Authentication-Results header, so the
// first occurrence reflects the verification done at our own MX.
export function extractSecurityDetails(headers: Array<Header>): SecurityDetails {
  const find = (key: string) => headers.filter((header) => header.key.toLowerCase() === key)
  const auth = find('authentication-results').map((header) => header.value).join('; ')
  const result = (method: string) => auth.match(new RegExp(`(?:^|[;\\s])${method}=([a-z]+)`, 'i'))?.[1]?.toLowerCase() ?? null
  const receivedSpf = find('received-spf')[0]?.value ?? ''
  const mailFrom = auth.match(/smtp\.mailfrom=([^\s;]+)/i)?.[1]
    ?? receivedSpf.match(/envelope-from=["']?([^\s;"']+)/i)?.[1]
  // Cloudflare reports a HELO-only SPF check when the envelope sender differs; the Received-SPF
  // header carries the envelope-from verdict, which is the one that matters.
  const spf = auth.match(/spf=([a-z]+)[^;]*smtp\.mailfrom=/i)?.[1]?.toLowerCase()
    ?? receivedSpf.match(/^\s*([a-z]+)/i)?.[1]?.toLowerCase()
    ?? result('spf')
  const signer = auth.match(/header\.d=([^\s;]+)/i)?.[1]
    ?? find('dkim-signature')[0]?.value.match(/(?:^|;)\s*d=([^\s;]+)/i)?.[1]
  // "with ESMTPS"/"SMTPS" or a TLS version means the hop was encrypted, "with SMTP"/"ESMTP" means plain text.
  // Cloudflare Email Routing records neither, so its hops leave the transport unknown.
  const transports = find('received')
    .map((header) => header.value.match(/\bwith\s+([A-Z0-9]*SMTPS?A?)\b/i)?.[1].toUpperCase() ?? (/\bTLS\d/i.test(header.value) ? 'TLS' : null))
    .filter((transport): transport is string => transport !== null)
  const encryption = transports.some((transport) => transport === 'TLS' || /SMTPSA?$/.test(transport)) ? 'tls' : transports.length ? 'none' : 'unknown'
  return {
    date: find('date')[0]?.value ?? null,
    mailedBy: mailFrom ? domainOf(mailFrom) : null,
    signedBy: signer ? domainOf(signer) : null,
    spf,
    dkim: result('dkim'),
    dmarc: result('dmarc'),
    encryption,
  }
}
