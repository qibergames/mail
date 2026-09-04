export function createPushPayload(locale: 'hu' | 'en', message: { id: string; from: string; subject?: string | null }, unread: number) {
  return {
    title: locale === 'en' ? 'New email' : 'Új levél',
    body: `${message.from}\n${message.subject || (locale === 'en' ? '(No subject)' : '(Nincs tárgy)')}`,
    tag: `message-${message.id}`,
    url: `/inbox?message=${encodeURIComponent(message.id)}`,
    unread,
  }
}
