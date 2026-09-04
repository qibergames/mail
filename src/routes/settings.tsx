import { createFileRoute, redirect } from '@tanstack/react-router'
import { Folder, ListFilter, Mail, Palette, UserRound } from 'lucide-react'
import { SectionShell } from '@/components/section-shell'
import { getSession } from '@/lib/session'

export const Route = createFileRoute('/settings')({
  beforeLoad: async ({ location }) => {
    if (!(await getSession())) throw redirect({ to: '/login' })
    if (location.pathname === '/settings') throw redirect({ to: '/settings/$section', params: { section: 'profile' } })
  },
  component: () => <SectionShell area="settings" title="Settings" items={[
    { section: 'profile', label: 'Profile', group: 'Account', icon: UserRound },
    { section: 'appearance', label: 'Appearance and notifications', group: 'Account', icon: Palette },
    { section: 'mailboxes', label: 'Mailboxes', group: 'Mailbox', icon: Mail },
    { section: 'folders', label: 'Custom folders', group: 'Mailbox', icon: Folder },
    { section: 'rules', label: 'Inbox rules', group: 'Mailbox', icon: ListFilter },
  ]} />,
})
