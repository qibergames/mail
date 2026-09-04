import { useEffect } from 'react'

export function ServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(console.error)
  }, [])
  return null
}
