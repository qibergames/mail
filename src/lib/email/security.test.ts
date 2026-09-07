import { expect, test } from 'bun:test'
import { extractHeaderAddresses, extractSecurityDetails } from './security'

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
    spf: 'pass',
    dkim: null,
    dmarc: null,
    encryption: 'none',
  })
})

test('treats a Cloudflare hop without transport details as unknown and reads SPF from Received-SPF', () => {
  expect(extractSecurityDetails([
    { key: 'Received', value: 'from a3-16.smtp-out.eu-west-1.amazonses.com (54.240.3.16) by cloudflare-email.net (cloudflare) id jxSjY0euxDfq for <info@example.com>; Sun, 06 Sep 2026 00:53:50 +0000' },
    { key: 'Received-SPF', value: 'pass (mx.cloudflare.net: domain of bounce@eu-west-1.amazonses.com designates 54.240.3.16 as permitted sender) receiver=mx.cloudflare.net; client-ip=54.240.3.16; envelope-from="bounce@eu-west-1.amazonses.com"; helo=a3-16.smtp-out.eu-west-1.amazonses.com;' },
    { key: 'Authentication-Results', value: 'mx.cloudflare.net; dkim=pass header.d=getlago.com header.s=abc header.b=CLAWMDU2; dkim=pass header.d=amazonses.com header.s=def header.b=BIPizBIN; dmarc=pass header.from=getlago.com policy.dmarc=none; spf=none (mx.cloudflare.net: no SPF records found for postmaster@a3-16.smtp-out.eu-west-1.amazonses.com) smtp.helo=a3-16.smtp-out.eu-west-1.amazonses.com;' },
  ])).toMatchObject({ mailedBy: 'eu-west-1.amazonses.com', signedBy: 'getlago.com', spf: 'pass', dkim: 'pass', dmarc: 'pass', encryption: 'unknown' })
})

test('reports failed verification and missing encryption', () => {
  expect(extractSecurityDetails([
    { key: 'Authentication-Results', value: 'mx.cloudflare.net; dkim=none; spf=fail smtp.mailfrom=spoof@evil.test; dmarc=fail header.from=bank.test' },
  ])).toMatchObject({ spf: 'fail', dkim: 'none', dmarc: 'fail', mailedBy: 'evil.test', signedBy: null, encryption: 'unknown' })
})

test('collects header recipients, flattening groups and keeping the first reply-to', () => {
  expect(extractHeaderAddresses({
    to: [{ name: 'Dr. Surányi', address: 'drsuranyi@medinice.hu' }, { name: 'undisclosed-recipients', group: [{ name: '', address: 'a@example.com' }] }],
    cc: [{ name: '', address: 'cc@example.com' }],
    replyTo: [{ name: 'Sales', address: 'sales@example.com' }],
  })).toEqual({ to: ['"Dr. Surányi" <drsuranyi@medinice.hu>', 'a@example.com'], cc: ['cc@example.com'], replyTo: '"Sales" <sales@example.com>' })
  expect(extractHeaderAddresses({})).toEqual({ to: [], cc: [], replyTo: null })
})
