import { createFileRoute } from '@tanstack/react-router'
import { hasAdmin, runSetup } from '@/lib/setup'

export const Route = createFileRoute('/api/setup')({
  server: {
    handlers: {
      GET: async () => Response.json({ configured: await hasAdmin() }),
      POST: ({ request }) => runSetup(request),
    },
  },
})
