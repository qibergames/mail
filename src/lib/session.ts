import { isRedirect, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from './auth'

export const getSession = createServerFn({ method: 'GET' }).handler(() =>
  auth.api.getSession({ headers: getRequest().headers }),
)

/**
 * Redirects to /login when there is no session. If the session check itself fails (offline, server
 * unreachable) the cached app shell is allowed to load so mail can still be read from the local cache.
 */
export async function ensureSignedIn() {
  try {
    if (!(await getSession())) throw redirect({ to: '/login' })
  } catch (error) {
    if (isRedirect(error)) throw error
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    throw error
  }
}
