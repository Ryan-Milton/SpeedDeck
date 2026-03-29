import type { ServerMessage } from '../types/gps'

type MessageHandler = (msg: ServerMessage) => void
type ConnectionHandler = (connected: boolean) => void

export class GpsWebSocketClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private url: string
  private _connected = false

  onMessage: MessageHandler | null = null
  onConnectionChange: ConnectionHandler | null = null

  constructor(url: string) {
    this.url = url
  }

  get connected(): boolean {
    return this._connected
  }

  connect(): void {
    if (this.ws) return

    try {
      this.ws = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = (): void => {
      this._connected = true
      this.onConnectionChange?.(true)
    }

    this.ws.onmessage = (event): void => {
      try {
        const data = JSON.parse(event.data) as ServerMessage
        this.onMessage?.(data)
      } catch {
        // Ignore malformed messages
      }
    }

    this.ws.onclose = (): void => {
      this._connected = false
      this.ws = null
      this.onConnectionChange?.(false)
      this.scheduleReconnect()
    }

    this.ws.onerror = (): void => {
      // onclose will fire after this
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this._connected = false
    this.onConnectionChange?.(false)
  }

  send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 1000)
  }
}
