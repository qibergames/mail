import { DurableObject } from 'cloudflare:workers'

export type RealtimeNotification = {
  type: 'message:new' | 'message:update' | 'counts:update'
  messageId?: string
  mailboxId?: string
}

export class RealtimeHub extends DurableObject<CloudflareEnv> {
  async fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === '/connect') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 })
      }

      const [client, server] = Object.values(new WebSocketPair())
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname === '/notify' && request.method === 'POST') {
      const message = JSON.stringify(await request.json<RealtimeNotification>())
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(message)
        } catch {
          socket.close(1011, 'Delivery failed')
        }
      }
      return new Response(null, { status: 204 })
    }

    return new Response('Not found', { status: 404 })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === 'ping') socket.send('pong')
  }
}
