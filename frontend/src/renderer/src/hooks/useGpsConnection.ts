import { useEffect, useRef } from 'react'
import { GpsWebSocketClient } from '../lib/ws-client'
import { useGpsStore } from '../stores/gps-store'
import { useHistoryStore } from '../stores/history-store'
import { showToast } from '../components/shared/Toast'
import type { GpsStateMessage } from '../types/gps'

const WS_URL = 'ws://127.0.0.1:8765'
const POLL_INTERVAL = 1500

export function useGpsConnection(): void {
  const clientRef = useRef<GpsWebSocketClient | null>(null)
  const graphCounterRef = useRef(0)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hadFixRef = useRef(false)
  const prevFixQualityRef = useRef(0)

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
        if (hadFixRef.current) {
          showToast('GPS connection lost', 'danger', 5000)
        }
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

        // GPS signal change toasts
        const fixQuality = data.fix?.fixQuality ?? 0
        const prevQuality = prevFixQualityRef.current

        if (fixQuality > 0 && prevQuality === 0 && hadFixRef.current) {
          // Signal regained after loss
          showToast('GPS signal restored', 'success', 3000)
        } else if (fixQuality === 0 && prevQuality > 0) {
          // Signal lost
          showToast('GPS signal lost — waiting for fix', 'warning', 5000)
        } else if (fixQuality > 0 && !hadFixRef.current) {
          // First fix acquired
          showToast('GPS fix acquired', 'success', 3000)
          hadFixRef.current = true
        }

        if (fixQuality > 0) hadFixRef.current = true
        prevFixQualityRef.current = fixQuality

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
