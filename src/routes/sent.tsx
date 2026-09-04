import { createFileRoute } from '@tanstack/react-router'
import { MailApp } from '@/components/mail-app'
import { ensureSignedIn } from '@/lib/session'

export const Route = createFileRoute('/sent')({
  beforeLoad: () => ensureSignedIn(),
  component: () => <MailApp view="sent" />,
})
