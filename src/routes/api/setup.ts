import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { hasAdmin, runSetup } from '@/lib/setup'

export const Route = createFileRoute('/api/setup')({
  server: {
    handlers: {
      GET: async () => Response.json({
        configured: await hasAdmin(),
        turnstileSiteKey: env.VITE_TURNSTILE_SITE_KEY?.trim() ?? '',
      }),
      POST: ({ request }) => runSetup(request),
    },
  },
})
