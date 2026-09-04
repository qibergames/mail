import { createFileRoute, redirect } from '@tanstack/react-router'
import { AdminApp } from '@/components/admin-app'
import { BackupApp } from '@/components/backup-app'

const sections = ['accounts', 'audit', 'backups', 'domains', 'mailboxes', 'aliases', 'access', 'routing'] as const
type AdminSection = typeof sections[number]
type AdminDataSection = Exclude<AdminSection, 'backups'>

export const Route = createFileRoute('/admin/$section')({
  beforeLoad: ({ params }) => { if (!sections.includes(params.section as AdminSection)) throw redirect({ to: '/admin/$section', params: { section: 'accounts' } }) },
  component: AdminSectionPage,
})

function AdminSectionPage() {
  const { section } = Route.useParams()
  return section === 'backups' ? <BackupApp /> : <AdminApp section={section as AdminDataSection} />
}
