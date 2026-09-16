import { appVersion } from './version'

/**
 * Notices when the server runs a newer build than the one loaded in this tab. Checks are cheap
 * (one small GET) and only run at moments a deploy is likely to have happened: the realtime socket
 * reconnecting, or the tab coming back to the foreground.
 */
type Listener = () => void

let updateAvailable = false
let checking: Promise<boolean> | null = null
let lastCheck = 0
const listeners = new Set<Listener>()

const MIN_INTERVAL = 30_000

export function isUpdateAvailable() {
  return updateAvailable
}

export function subscribeToUpdates(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Compares the served version with the bundled one. Resolves true when a newer build is live. */
export function checkForUpdate({ force = false } = {}) {
  if (updateAvailable) return Promise.resolve(true)
  if (checking) return checking
  if (!force && Date.now() - lastCheck < MIN_INTERVAL) return Promise.resolve(false)
  checking = (async () => {
    try {
      const response = await fetch('/api/version', { cache: 'no-store' })
      if (!response.ok) return false
      const served = await response.json<{ sha: string; builtAt: string }>()
      if (!isNewer(served, appVersion)) return false
      updateAvailable = true
      for (const listener of listeners) listener()
      return true
    } catch {
      return false
    } finally {
      lastCheck = Date.now()
      checking = null
    }
  })()
  return checking
}

/**
 * A build is newer when it is a different commit built later. The timestamp guard keeps a stale
 * cached response, or a rollback that a tab already runs, from nagging for a refresh.
 */
export function isNewer(served: { sha: string; builtAt: string }, current: { sha: string; builtAt: string }) {
  if (served.sha === current.sha) return false
  const servedAt = Date.parse(served.builtAt)
  const currentAt = Date.parse(current.builtAt)
  if (Number.isNaN(servedAt) || Number.isNaN(currentAt)) return true
  return servedAt > currentAt
}

/** Re-checks whenever the tab becomes visible again. Installed once, by the first component that mounts. */
let watching = false
export function watchForUpdates() {
  if (watching || typeof document === 'undefined') return
  watching = true
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForUpdate() })
}
