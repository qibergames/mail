import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void }) => string
      remove: (id: string) => void
    }
  }
}

export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!siteKey) {
      onToken('development')
      return
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => {
      if (container.current && window.turnstile) {
        window.turnstile.render(container.current, { sitekey: siteKey, callback: onToken })
      }
    }
    document.head.appendChild(script)
    return () => {
      script.parentNode?.removeChild(script)
    }
  }, [onToken, siteKey])

  return <div ref={container} />
}
