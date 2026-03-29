import { useEffect, useRef } from 'react'
import { GpsWebSocketClient } from '../lib/ws-client'
import { useGpsStore } from '../stores/gps-store'
import { useHistoryStore } from '../stores/history-store'
import type { GpsStateMessage } from '../types/gps'

const WS_URL = 'ws://127.0.0.1:8765'

export function useGpsConnection(): void {
  const clientRef = useRef<GpsWebSocketClient | null>(null)
  const graphCounterRef = useRef(0)

  useEffect(() => {
    const client = new GpsWebSocketClient(WS_URL)
    clientRef.current = client

    client.onConnectionChange = (connected): void => {
      useGpsStore.getState().setConnected(connected)
    }

    client.onMessage = (msg): void => {
      if (msg.type === 'gpsState') {
        const data = msg as GpsStateMessage
        useGpsStore.getState().updateFromServer(data)

        // Downsample to 1Hz for the history graph
        graphCounterRef.current++
        if (graphCounterRef.current >= 10) {
          graphCounterRef.current = 0
          useHistoryStore.getState().push(Date.now(), data.smoothedSpeed)
        }
      }
    }

    client.connect()

    return (): void => {
      client.disconnect()
    }
  }, [])
}

export function useGpsClient(): GpsWebSocketClient | null {
  const clientRef = useRef<GpsWebSocketClient | null>(null)

  useEffect(() => {
    // Create a shared client reference for sending commands
    const client = new GpsWebSocketClient(WS_URL)
    clientRef.current = client
    client.connect()
    return (): void => client.disconnect()
  }, [])

  return clientRef.current
}
