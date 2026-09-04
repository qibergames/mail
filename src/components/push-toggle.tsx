import { Trans, useLingui } from '@lingui/react'
import { Bell, BellOff, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const bytes = Uint8Array.from(atob((value + padding).replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0))
  return bytes.buffer
}

export function PushToggle() {
  const { i18n } = useLingui()
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

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
    try {
      const registration = await navigator.serviceWorker.ready
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
      if (await Notification.requestPermission() !== 'granted') { setSubscribed(false); return }
      const response = await fetch('/api/push')
      if (!response.ok) throw new Error('Push is not configured')
      const { publicKey } = await response.json<{ publicKey: string }>()
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      })
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
    } finally {
      setBusy(false)
    }
  }

  if (!supported) return null
  return (
    <div className="flex items-center gap-3">
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
