type Header = { key: string; value: string }

export type SpamSignals = {
  headers: Array<Header>
  /** The address the message was actually delivered to. */
  envelopeTo: string
  /** The sender address from the From header. */
  from: string
  /** To and Cc addresses written in the message. */
  recipients: Array<string>
  /** Domains hosted by this instance; nobody else may send as them. */
  hostedDomains: Array<string>
  /** How many of the user's earlier messages from the sender's domain sit in spam, and how many elsewhere. */
  senderDomainHistory: { spam: number; kept: number }
  /** Workers AI judged the content to be spam with high confidence. */
  aiFlagged?: boolean
  /** Calibrated probability from the judgment model that this is unsolicited bulk mail, a scam or phishing. */
  unsolicited?: number | null
}

export type SpamVerdict = { spam: boolean; score: number; reasons: Array<string> }

export const SPAM_THRESHOLD = 5

/** Unsigned mail below the threshold is the only mail worth a Workers AI second opinion. */
export const needsSecondOpinion = (verdict: SpamVerdict) => !verdict.spam && verdict.reasons.includes('unsigned')

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase()
const aligned = (domain: string | undefined, fromDomain: string) => Boolean(domain) && (domain === fromDomain || domain!.endsWith(`.${fromDomain}`))

// Cloudflare Email Routing prepends its own Authentication-Results, so the first header is our MX's verdict.
function authResults(headers: Array<Header>) {
  const auth = headers.find((header) => header.key.toLowerCase() === 'authentication-results')?.value ?? ''
  const receivedSpf = headers.find((header) => header.key.toLowerCase() === 'received-spf')?.value ?? ''
  // A HELO-only SPF check says nothing about the sender; the one tied to smtp.mailfrom does.
  const mailFromSpf = auth.split(';').find((part) => /smtp\.mailfrom=/i.test(part))
  const spf = mailFromSpf?.match(/spf=([a-z]+)/i)?.[1] ?? receivedSpf.match(/^\s*([a-z]+)/i)?.[1] ?? null
  return {
    spf: spf?.toLowerCase() ?? null,
    spfDomain: mailFromSpf?.match(/smtp\.mailfrom=(?:[^\s;@]*@)?([^\s;]+)/i)?.[1]?.toLowerCase(),
    dkimPassDomains: [...auth.matchAll(/dkim=pass[^;]*?header\.d=([^\s;]+)/gi)].map((match) => match[1].toLowerCase()),
    dmarc: auth.match(/dmarc=([a-z]+)/i)?.[1]?.toLowerCase() ?? null,
  }
}

/**
 * Scores inbound mail on transport evidence rather than wording. Mail that passes DKIM needs strong extra
 * evidence to land in spam, while unsigned bulk mail addressed to somebody else crosses the threshold alone.
 */
export function classifySpam(signals: SpamSignals): SpamVerdict {
  const reasons: Array<string> = []
  let score = 0
  const add = (points: number, reason: string) => {
    score += points
    reasons.push(reason)
  }
  const auth = authResults(signals.headers)
  const fromDomain = domainOf(signals.from)
  const dkimPass = auth.dkimPassDomains.length > 0

  if (!dkimPass) add(2, 'unsigned')
  if (auth.spf === 'fail' || auth.spf === 'softfail') add(3, `spf-${auth.spf}`)
  if (auth.dmarc === 'fail') add(4, 'dmarc-fail')

  const authenticated = auth.dmarc === 'pass'
    || auth.dkimPassDomains.some((domain) => aligned(domain, fromDomain))
    || (auth.spf === 'pass' && aligned(auth.spfDomain, fromDomain))
  if (signals.hostedDomains.some((domain) => aligned(fromDomain, domain.toLowerCase())) && !authenticated) add(4, 'spoofed-hosted-domain')

  // Bcc is legitimate, but unsigned mail whose headers name a stranger is the hallmark of list spam.
  const envelope = signals.envelopeTo.toLowerCase()
  if (!signals.recipients.some((recipient) => recipient.toLowerCase() === envelope)) add(dkimPass ? 1 : 3, 'not-addressed')

  const cloudflareScore = Number(signals.headers.find((header) => header.key.toLowerCase() === 'x-cf-spamh-score')?.value)
  if (Number.isFinite(cloudflareScore) && cloudflareScore > 0) add(Math.min(cloudflareScore, 5), `cloudflare-${cloudflareScore}`)

  const history = signals.senderDomainHistory
  if (history.spam >= 2 && history.spam > history.kept) add(3, 'reported-domain')
  if (signals.aiFlagged) add(3, 'ai-spam')
  // A calibrated probability says more than a yes or no, and a confident "no" is evidence for the message too.
  const unsolicited = signals.unsolicited
  if (typeof unsolicited === 'number') {
    if (unsolicited >= 0.9) add(4, 'judged-spam')
    else if (unsolicited >= 0.75) add(2, 'judged-likely-spam')
    else if (unsolicited <= 0.1) add(-2, 'judged-wanted')
  }

  return { spam: score >= SPAM_THRESHOLD, score, reasons }
}
