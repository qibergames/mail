import { createFileRoute, redirect } from '@tanstack/react-router'
import { SettingsApp } from '@/components/settings-app'

const sections = ['profile', 'appearance', 'mailboxes', 'folders', 'rules'] as const
type SettingsSection = typeof sections[number]

export const Route = createFileRoute('/settings/$section')({
  beforeLoad: ({ params }) => { if (!sections.includes(params.section as SettingsSection)) throw redirect({ to: '/settings/$section', params: { section: 'profile' } }) },
  component: () => <SettingsApp section={Route.useParams().section as SettingsSection} />,
})
