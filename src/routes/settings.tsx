import { createFileRoute, redirect } from '@tanstack/react-router'
import { SettingsApp } from '@/components/settings-app'
import { getSession } from '@/lib/session'

export const Route = createFileRoute('/settings')({
  beforeLoad: async () => { if (!(await getSession())) throw redirect({ to: '/login' }) },
  component: SettingsApp,
})
