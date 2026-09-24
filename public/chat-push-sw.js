/* Imported by the generated Workbox worker. */
self.addEventListener('activate', event => { event.waitUntil(caches.delete('supabase-api')) })
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload
    try { payload = event.data?.json() } catch { return }
    if (payload?.type !== 'chat-message') return
    const cache = await caches.open('margoline-push-preferences')
    const response = await cache.match('/__chat_push_owner')
    const owner = response ? await response.json() : null
    if (!owner?.enabled || owner.userId !== payload.recipientId) return
    await self.registration.showNotification('MargoLine — nowa wiadomość', {
      body: 'Masz nową wiadomość w komunikatorze. Dotknij, aby otworzyć.',
      icon: '/pwa-192x192.png', badge: '/pwa-192x192.png',
      tag: `chat-${payload.conversationId}`, renotify: true,
      data: { recipientId: payload.recipientId, senderId: payload.senderId },
    })
  })())
})

self.addEventListener('notificationclick', event => {
  // Leave other application notifications to their own handlers.
  if (!event.notification.tag?.startsWith('chat-')) return
  event.notification.close()
  event.waitUntil((async () => {
    const sender = event.notification.data?.senderId
    const recipient = event.notification.data?.recipientId
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const url = new URL('/messages', self.location.origin)
    if (uuid.test(sender) && uuid.test(recipient)) {
      url.searchParams.set('person', sender)
      url.searchParams.set('account', recipient)
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        if (new URL(client.url).pathname === '/login') {
          await client.navigate(url.href)
          await client.focus()
          return
        }
        // Avoid reloading a page with an unsaved production form.
        client.postMessage({ type: 'chat-push-open', path: url.pathname + url.search })
        await client.focus()
        return
      }
    }
    await self.clients.openWindow(url.href)
  })())
})
