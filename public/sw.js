const VERSION = 'v2'
const SHELL_CACHE = `qibermail-shell-${VERSION}`
const ASSET_CACHE = `qibermail-assets-${VERSION}`
const MAIL_VIEWS = ['/inbox', '/sent', '/drafts', '/starred', '/snoozed', '/archived', '/spam', '/trash', '/folders/']
const STATIC = ['/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(ASSET_CACHE).then((cache) => cache.addAll(STATIC).catch(() => undefined)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('qibermail-') && !key.endsWith(VERSION)).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

function isMailView(pathname) {
  return MAIL_VIEWS.some((view) => view.endsWith('/') ? pathname.startsWith(view) : pathname === view)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // App shell: network first so deploys land immediately; fall back to the last good shell offline.
  if (request.mode === 'navigate') {
    if (!isMailView(url.pathname)) return
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
          const cache = await caches.open(SHELL_CACHE)
          await cache.put('/inbox', response.clone())
        }
        return response
      } catch {
        const cached = await caches.match('/inbox', { cacheName: SHELL_CACHE })
        return cached ?? new Response('<!doctype html><title>QiberMail</title><p style="font-family:sans-serif;padding:2rem">You are offline and QiberMail has not been cached yet.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }
    })())
    return
  }

  // Hashed build assets and static icons: cache first, they never change under the same URL.
  if (url.pathname.startsWith('/assets/') || STATIC.includes(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { cacheName: ASSET_CACHE })
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        const cache = await caches.open(ASSET_CACHE)
        await cache.put(request, response.clone())
      }
      return response
    })())
  }
  // API requests are left to the page: the mail store keeps its own IndexedDB cache.
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    payload = { title: 'QiberMail', body: event.data?.text() ?? '' }
  }
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title || 'QiberMail', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag || 'qibermail-message',
      data: { url: payload.url || '/inbox' },
    }),
    typeof self.navigator.setAppBadge === 'function'
      ? self.navigator.setAppBadge(payload.unread || 1)
      : Promise.resolve(),
  ]))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/inbox', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) {
      await existing.navigate(target)
      return existing.focus()
    }
    return self.clients.openWindow(target)
  }))
})
