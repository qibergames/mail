import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from '@/lib/auth'
import { hasAdmin } from '@/lib/setup'

const getLanding = createServerFn({ method: 'GET' }).handler(async () => ({
  configured: await hasAdmin(),
  session: await auth.api.getSession({ headers: getRequest().headers }),
}))

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const { configured, session } = await getLanding()
    throw redirect({ to: session ? '/inbox' : configured ? '/login' : '/setup' })
  },
  component: () => null,
})
