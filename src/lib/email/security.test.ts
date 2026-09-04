import { expect, test } from 'bun:test'
import { extractSecurityDetails } from './security'

test('reads authentication results, sender domains and TLS from raw headers', () => {
  expect(extractSecurityDetails([
    { key: 'Received', value: 'from mail-sor-f41.hetzner.com (mail-sor-f41.hetzner.com [1.2.3.4]) by mx.cloudflare.net with ESMTPS id abc (version=TLS1_3 cipher=TLS_AES_256_GCM_SHA384)' },
    { key: 'Authentication-Results', value: 'mx.cloudflare.net; dkim=pass header.d=hetzner.com header.b=abc123; spf=pass (mx.cloudflare.net: domain designates 1.2.3.4 as permitted sender) smtp.mailfrom=suspension-accountancy@hetzner.com; dmarc=pass header.from=hetzner.com; arc=none' },
    { key: 'Date', value: 'Thu, 4 Sep 2026 12:15:00 +0200' },
  ])).toEqual({
    date: 'Thu, 4 Sep 2026 12:15:00 +0200',
    mailedBy: 'hetzner.com',
    signedBy: 'hetzner.com',
    spf: 'pass',
    dkim: 'pass',
    dmarc: 'pass',
    encryption: 'tls',
  })
})

test('falls back to DKIM-Signature and Received-SPF when authentication results are missing', () => {
  expect(extractSecurityDetails([
    { key: 'Received', value: 'from relay.example.com by mx.example.net with SMTP id xyz' },
    { key: 'Received-SPF', value: 'pass (domain of example.com designates 1.2.3.4 as permitted sender) envelope-from="news@mailer.example.com";' },
    { key: 'DKIM-Signature', value: 'v=1; a=rsa-sha256; d=mailer.example.com; s=selector; h=from:to' },
  ])).toEqual({
    date: null,
    mailedBy: 'mailer.example.com',
    signedBy: 'mailer.example.com',
    spf: null,
    dkim: null,
    dmarc: null,
    encryption: 'none',
  })
})

test('reports failed verification and missing encryption', () => {
  expect(extractSecurityDetails([
    { key: 'Authentication-Results', value: 'mx.cloudflare.net; dkim=none; spf=fail smtp.mailfrom=spoof@evil.test; dmarc=fail header.from=bank.test' },
  ])).toMatchObject({ spf: 'fail', dkim: 'none', dmarc: 'fail', mailedBy: 'evil.test', signedBy: null, encryption: 'none' })
})
