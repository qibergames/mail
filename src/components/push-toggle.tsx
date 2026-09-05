import { Trans, useLingui } from '@lingui/react'
import { Bell, BellOff, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'
import { decodeBase64Url, normalizeVapidKey } from '@/lib/vapid'

function applicationServerKey(value: string) {
  const normalized = normalizeVapidKey(value, 65)
  if (!normalized.key) throw new Error(`Invalid VAPID public key (${normalized.error})`)
  return decodeBase64Url(normalized.key)!.buffer as ArrayBuffer
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then((value) => { clearTimeout(timer); resolve(value) }, (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) })
  })
}

export function PushToggle() {
  const { i18n } = useLingui()
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  useEffect(() => {
    if (!supported) return
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        setSubscribed(Boolean(subscription))
        if (subscription) return fetch('/api/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subscription.toJSON(), locale: i18n.locale }),
        })
      })
      .catch((error) => { console.error(error); setSubscribed(false) })
  }, [i18n.locale, supported])

  async function toggle() {
    if (!supported) return
    setBusy(true)
    setFailure('')
    try {
      const registration = await withTimeout(navigator.serviceWorker.ready, 10_000, i18n._('The service worker did not start. Reload the page and try again.'))
      const current = await registration.pushManager.getSubscription()
      if (current) {
        await fetch('/api/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: current.endpoint }),
        })
        await current.unsubscribe()
        setSubscribed(false)
        return
      }
      if (await Notification.requestPermission() !== 'granted') { setSubscribed(false); setFailure(i18n._('Notifications are blocked for this site. Allow them in the browser\'s site settings and try again.')); return }
      const response = await fetch('/api/push')
      const body = await response.json<{ publicKey?: string; error?: string }>().catch(() => null)
      if (!response.ok || !body?.publicKey) throw new Error(body?.error || i18n._('Push notifications are not configured on the server.'))
      const publicKey = body.publicKey
      // subscribe() never settles when the browser cannot reach its push service (some webviews, blocked networks).
      const subscription = await withTimeout(registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      }), 20_000, i18n._('The browser\'s push service did not respond. Try again in a regular browser window.'))
      const saved = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON(), locale: i18n.locale }),
      })
      if (!saved.ok) {
        await subscription.unsubscribe()
        throw new Error('Push subscription failed')
      }
      setSubscribed(true)
    } catch (caught) {
      console.error(caught)
      setFailure(caught instanceof Error ? caught.message : i18n._('Push subscription failed'))
    } finally {
      setBusy(false)
    }
  }

  if (!supported) return <span className="text-xs text-muted-foreground"><Trans id="Not supported in this browser" /></span>
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {failure && <span role="alert" className="basis-full text-right text-xs text-red-600 dark:text-red-400">{failure}</span>}
      <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium', subscribed === true ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : subscribed === false ? 'bg-muted text-muted-foreground' : 'border-primary/30 bg-primary/10 text-primary')}>
        <span className={cn('size-2 rounded-full', subscribed === true ? 'bg-emerald-500' : subscribed === false ? 'bg-muted-foreground' : 'animate-pulse bg-primary')} />
        {subscribed === null ? <Trans id="Checking…" /> : subscribed ? <Trans id="Notifications on" /> : <Trans id="Notifications off" />}
      </span>
      <Button variant="ghost" size="icon" onClick={toggle} disabled={busy || subscribed === null} aria-pressed={subscribed === true} title={i18n._(subscribed ? 'Disable notifications' : 'Enable notifications')}>
        {busy || subscribed === null ? <LoaderCircle className="animate-spin" /> : subscribed ? <Bell /> : <BellOff />}
        <span className="sr-only">{i18n._(subscribed ? 'Disable notifications' : 'Enable notifications')}</span>
      </Button>
    </div>
  )
}
