export type SecurityDetails = {
  date: string | null
  mailedBy: string | null
  signedBy: string | null
  spf: string | null
  dkim: string | null
  dmarc: string | null
  encryption: 'tls' | 'none'
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
  const mailFrom = auth.match(/smtp\.mailfrom=([^\s;]+)/i)?.[1]
    ?? find('received-spf')[0]?.value.match(/envelope-from=["']?([^\s;"']+)/i)?.[1]
  const signer = auth.match(/header\.d=([^\s;]+)/i)?.[1]
    ?? find('dkim-signature')[0]?.value.match(/(?:^|;)\s*d=([^\s;]+)/i)?.[1]
  const encrypted = find('received').some((header) => /\bE?SMTPSA?\b|\bTLS/i.test(header.value))
  return {
    date: find('date')[0]?.value ?? null,
    mailedBy: mailFrom ? domainOf(mailFrom) : null,
    signedBy: signer ? domainOf(signer) : null,
    spf: result('spf'),
    dkim: result('dkim'),
    dmarc: result('dmarc'),
    encryption: encrypted ? 'tls' : 'none',
  }
}
