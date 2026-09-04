import { createFileRoute, redirect } from '@tanstack/react-router'
import { AtSign, DatabaseBackup, Globe2, Mail, Route as RouteIcon, ScrollText, UserRoundCog, Users } from 'lucide-react'
import { SectionShell } from '@/components/section-shell'
import { getSession } from '@/lib/session'

export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/inbox' })
    if (location.pathname === '/admin') throw redirect({ to: '/admin/$section', params: { section: 'accounts' } })
  },
  component: () => <SectionShell area="admin" title="Administration" items={[
    { section: 'accounts', label: 'Accounts', group: 'Administration', icon: Users },
    { section: 'audit', label: 'Audit log', group: 'Administration', icon: ScrollText },
    { section: 'backups', label: 'Backup and restore', group: 'Administration', icon: DatabaseBackup },
    { section: 'domains', label: 'Domains', group: 'Email', icon: Globe2 },
    { section: 'mailboxes', label: 'Mailboxes', group: 'Email', icon: Mail },
    { section: 'aliases', label: 'Aliases', group: 'Email', icon: AtSign },
    { section: 'access', label: 'Shared access', group: 'Email', icon: UserRoundCog },
    { section: 'routing', label: 'Domain routing', group: 'Email', icon: RouteIcon },
  ]} />,
})
