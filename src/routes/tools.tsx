import { createFileRoute, redirect } from '@tanstack/react-router'
import { ToolsApp } from '@/components/tools-app'
import { getSession } from '@/lib/session'

export const Route = createFileRoute('/tools')({
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/login' })
    return { toolsAdmin: session.user.role === 'admin' }
  },
  component: () => <ToolsApp admin={Route.useRouteContext().toolsAdmin} />,
})
