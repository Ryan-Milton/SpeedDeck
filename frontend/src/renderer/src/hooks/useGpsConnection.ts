import { useEffect, useRef } from 'react'
import { GpsWebSocketClient } from '../lib/ws-client'
import { useGpsStore } from '../stores/gps-store'
import { useHistoryStore } from '../stores/history-store'
import type { GpsStateMessage } from '../types/gps'

const WS_URL = 'ws://127.0.0.1:8765'
const POLL_INTERVAL = 1500

export function useGpsConnection(): void {
  const clientRef = useRef<GpsWebSocketClient | null>(null)
  const graphCounterRef = useRef(0)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const client = new GpsWebSocketClient(WS_URL)
    clientRef.current = client

    const stopPolling = (): void => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }

    client.onConnectionChange = (connected): void => {
      useGpsStore.getState().setConnected(connected)
      if (connected) {
        // Poll for GPS status until we get a fix
        stopPolling()
        pollTimerRef.current = setInterval(() => {
          if (useGpsStore.getState().fix) {
            stopPolling()
            return
          }
          client.send({ type: 'command', action: 'get_status' })
        }, POLL_INTERVAL)
      } else {
        stopPolling()
      }
    }

    client.onMessage = (msg): void => {
      if (msg.type === 'gpsState') {
        const data = msg as GpsStateMessage
        useGpsStore.getState().updateFromServer(data)

        // Stop polling once we have a fix
        if (data.fix && pollTimerRef.current) {
          stopPolling()
        }

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
      stopPolling()
      client.disconnect()
    }
  }, [])
}

export function useGpsClient(): GpsWebSocketClient | null {
  const clientRef = useRef<GpsWebSocketClient | null>(null)

  useEffect(() => {
    const client = new GpsWebSocketClient(WS_URL)
    clientRef.current = client
    client.connect()
    return (): void => client.disconnect()
  }, [])

  return clientRef.current
}
