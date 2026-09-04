import { createFileRoute, redirect } from '@tanstack/react-router'
import { AdminApp } from '@/components/admin-app'
import { getSession } from '@/lib/session'

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/inbox' })
  },
  component: AdminApp,
})
