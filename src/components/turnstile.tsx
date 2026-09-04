import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: {
        sitekey: string
        callback: (token: string) => void
        'error-callback': () => void
        'expired-callback': () => void
        'timeout-callback': () => void
      }) => string
      remove: (id: string) => void
      reset: (id: string) => void
    }
  }
}

export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let script: HTMLScriptElement | undefined
    let widgetId: string | undefined

    const reset = () => {
      onToken('')
      if (widgetId) window.turnstile?.reset(widgetId)
    }

    const render = (siteKey: string) => {
      if (container.current && window.turnstile) {
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          callback: onToken,
          'error-callback': () => onToken(''),
          'expired-callback': reset,
          'timeout-callback': reset,
        })
      }
    }

    void fetch('/api/setup')
      .then((response) => response.json<{ turnstileSiteKey?: string }>())
      .then(({ turnstileSiteKey }) => {
        if (cancelled) return
        if (!turnstileSiteKey) return onToken('development')
        if (window.turnstile) return render(turnstileSiteKey)
        script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        script.onload = () => render(turnstileSiteKey)
        document.head.appendChild(script)
      })
      .catch((error) => console.error('Turnstile configuration failed', error))

    return () => {
      cancelled = true
      if (widgetId) window.turnstile?.remove(widgetId)
      script?.remove()
    }
  }, [onToken])

  return <div ref={container} />
}
