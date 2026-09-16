import { createFileRoute } from '@tanstack/react-router'
import { appVersion } from '@/lib/version'

/** The build the Worker is running. Public: clients compare it with their bundled version to offer a refresh. */
export const Route = createFileRoute('/api/version')({
  server: {
    handlers: {
      GET: () => Response.json(appVersion, { headers: { 'Cache-Control': 'no-store' } }),
    },
  },
})
