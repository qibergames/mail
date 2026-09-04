self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

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
