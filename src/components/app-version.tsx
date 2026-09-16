import { Trans, useLingui } from '@lingui/react'
import { RefreshCw } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { Button } from './ui/button'
import { isUpdateAvailable, subscribeToUpdates, watchForUpdates } from '@/lib/app-update'
import { appVersion, commitUrl, describeAge, formatBuildTime, shortSha } from '@/lib/version'
import { cn } from '@/lib/utils'

function useUpdateAvailable() {
  useEffect(watchForUpdates, [])
  return useSyncExternalStore(subscribeToUpdates, isUpdateAvailable, () => false)
}

/**
 * One quiet line saying which build is running and when it was released, so a glance tells whether
 * a deploy has landed. Turns into a refresh prompt once a newer build is live.
 */
export function AppVersion({ className }: { className?: string }) {
  const { i18n } = useLingui()
  const updateAvailable = useUpdateAvailable()
  const age = describeAge(appVersion.builtAt, i18n.locale)
  const sha = shortSha(appVersion.sha)
  const title = i18n._('Version {sha}, built {time}', { sha, time: formatBuildTime(appVersion.builtAt, i18n.locale) })
  const url = commitUrl(appVersion.sha)
  if (updateAvailable) {
    return <button type="button" onClick={() => location.reload()} className={cn('flex items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs font-medium text-primary hover:bg-accent', className)} title={title}>
      <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-primary" /></span>
      <Trans id="New version available, refresh" />
    </button>
  }
  return <p className={cn('truncate px-2 text-xs text-muted-foreground', className)} title={title}>
    {age ? <Trans id="Updated {time}" values={{ time: age }} /> : <Trans id="Version" />}
    {' · '}
    {url ? <a href={url} target="_blank" rel="noreferrer" className="font-mono hover:underline">{sha}</a> : <span className="font-mono">{sha}</span>}
  </p>
}

/** Bottom-of-screen toast shown on every page once the server runs a newer build than this tab. */
export function UpdateNotice() {
  const updateAvailable = useUpdateAvailable()
  if (!updateAvailable) return null
  return <div role="status" className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
    <div className="flex items-center gap-3 rounded-full border bg-popover py-2 pr-2 pl-4 text-sm text-popover-foreground shadow-xl">
      <Trans id="A new version of QiberMail is available." />
      <Button size="sm" className="rounded-full" onClick={() => location.reload()}><RefreshCw /><Trans id="Refresh" /></Button>
    </div>
  </div>
}
