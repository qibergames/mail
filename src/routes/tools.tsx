import { createFileRoute, redirect } from '@tanstack/react-router'
import { CalendarDays, ContactRound, FileText, Import, KeyRound, Webhook } from 'lucide-react'
import { SectionShell } from '@/components/section-shell'
import { getSession } from '@/lib/session'

export const Route = createFileRoute('/tools')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/login' })
    if (location.pathname === '/tools') throw redirect({ to: '/tools/$section', params: { section: 'contacts' } })
  },
  component: () => <SectionShell area="tools" title="Tools" items={[
    { section: 'contacts', label: 'Contacts and blocklist', group: 'Productivity', icon: ContactRound },
    { section: 'templates', label: 'Templates', group: 'Productivity', icon: FileText },
    { section: 'calendar', label: 'Calendar', group: 'Productivity', icon: CalendarDays },
    { section: 'api-keys', label: 'API keys', group: 'Integrations', icon: KeyRound },
    { section: 'webhooks', label: 'Webhooks', group: 'Integrations', icon: Webhook },
    { section: 'import-export', label: 'Mail import and export', group: 'Data', icon: Import },
  ]} />,
})
