import { createFileRoute } from '@tanstack/react-router'
import { MailApp } from '@/components/mail-app'
import { ensureSignedIn } from '@/lib/session'

export const Route = createFileRoute('/spam')({
  beforeLoad: () => ensureSignedIn(),
  component: () => <MailApp view="spam" />,
})
