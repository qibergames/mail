import { expect, test } from 'bun:test'
import PostalMime from 'postal-mime'
import { isEmailSendingEvent, parseDeliveryReport } from './delivery-report'

const dsn = `From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>
To: info@qibergames.com
Subject: Delivery Status Notification (Failure)
MIME-Version: 1.0
Content-Type: multipart/report; boundary="BOUND"; report-type=delivery-status

--BOUND
Content-Type: text/plain; charset="UTF-8"

Your message wasn't delivered to nobody@example.com because the address couldn't be found.

--BOUND
Content-Type: message/delivery-status

Reporting-MTA: dns; googlemail.com

Final-Recipient: rfc822; nobody@example.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does
 not exist.

Final-Recipient: rfc822; later@example.com
Action: delayed
Status: 4.4.1

--BOUND
Content-Type: text/rfc822-headers

From: info@qibergames.com
To: nobody@example.com
Message-ID: <abc123@qibergames.com>
--BOUND--
`

test('reads failed recipients, folded diagnostics and the original Message-ID from a DSN', async () => {
  expect(parseDeliveryReport(await PostalMime.parse(dsn))).toEqual({
    originalMessageId: '<abc123@qibergames.com>',
    failures: [{ recipient: 'nobody@example.com', status: '5.1.1', reason: '550-5.1.1 The email account that you tried to reach does not exist.' }],
  })
})

test('ignores ordinary mail and reports that only announce a delay', async () => {
  expect(parseDeliveryReport(await PostalMime.parse('From: mailer-daemon@example.com\nSubject: Undelivered Mail Returned to Sender\n\nnobody@example.com: user unknown'))).toBeNull()
  expect(parseDeliveryReport(await PostalMime.parse(dsn.replace('Action: failed', 'Action: delayed')))).toBeNull()
})

test('recognises Email Sending events and nothing else on the queue', () => {
  expect(isEmailSendingEvent({ type: 'cf.email.sending.message.bounced', payload: { recipient: 'a@example.com' } })).toBe(true)
  expect(isEmailSendingEvent({ type: 'inbound-mail', rawR2Key: 'x' })).toBe(false)
  expect(isEmailSendingEvent(null)).toBe(false)
})
