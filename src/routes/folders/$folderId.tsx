import { createFileRoute } from '@tanstack/react-router'
import { MailApp } from '@/components/mail-app'
import { ensureSignedIn } from '@/lib/session'

export const Route = createFileRoute('/folders/$folderId')({
  beforeLoad: () => ensureSignedIn(),
  component: () => <MailApp view="inbox" folderId={Route.useParams().folderId} />,
})
