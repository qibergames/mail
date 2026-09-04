import { createFileRoute, redirect } from '@tanstack/react-router'
import { MailApp } from '@/components/mail-app'
import { getSession } from '@/lib/session'

export const Route = createFileRoute('/folders/$folderId')({
  beforeLoad: async () => { if (!(await getSession())) throw redirect({ to: '/login' }) },
  component: () => <MailApp view="inbox" folderId={Route.useParams().folderId} />,
})
