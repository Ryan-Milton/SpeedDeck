import { useEffect, useRef } from 'react'
import { GpsWebSocketClient } from '../lib/ws-client'
import { useGpsStore } from '../stores/gps-store'
import { useNavigationStore } from '../stores/navigation-store'
import type { GeocodeResultsMessage, RouteDataMessage, NavStatusMessage } from '../types/navigation'

const WS_URL = 'ws://127.0.0.1:8765'
const REROUTE_DELAY_MS = 3000

export function useNavigation(): void {
  const wsRef = useRef<GpsWebSocketClient | null>(null)
  const rerouteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Create a dedicated WebSocket client for navigation commands
  useEffect(() => {
    const client = new GpsWebSocketClient(WS_URL)
    wsRef.current = client

    client.onMessage = (msg): void => {
      const data = msg as Record<string, unknown>

      if (data.type === 'geocodeResults') {
        const geo = data as unknown as GeocodeResultsMessage
        useNavigationStore.getState().setSearchResults(geo.results)
      } else if (data.type === 'routeData') {
        const route = data as unknown as RouteDataMessage
        useNavigationStore.getState().setRoute(route.route)
        useNavigationStore.getState().setIsCalculating(false)
      } else if (data.type === 'navStatus') {
        const status = data as unknown as NavStatusMessage
        useNavigationStore.getState().setOsrmReady(status.routerRunning)
      } else if (data.type === 'navError') {
        useNavigationStore.getState().setIsCalculating(false)
      }
    }

    client.onConnectionChange = (connected): void => {
      if (connected) {
        // Check OSRM status on connect
        client.send({ type: 'command', action: 'nav_get_status' })
      }
    }

    client.connect()

    return (): void => {
      client.disconnect()
      if (rerouteTimerRef.current) clearTimeout(rerouteTimerRef.current)
    }
  }, [])

  // Feed GPS updates into navigation position tracking
  useEffect(() => {
    const unsub = useGpsStore.subscribe((state) => {
      const nav = useNavigationStore.getState()
      if (nav.status !== 'navigating' || !state.fix) return

      nav.updatePosition(
        state.fix.latitude,
        state.fix.longitude,
        state.fix.heading,
        state.smoothedSpeed
      )
    })

    return unsub
  }, [])

  // Watch for off-route and trigger reroute
  useEffect(() => {
    const unsub = useNavigationStore.subscribe((state, prev) => {
      if (state.isOffRoute && !prev.isOffRoute) {
        // Start reroute timer
        rerouteTimerRef.current = setTimeout(() => {
          const nav = useNavigationStore.getState()
          const gps = useGpsStore.getState()
          if (nav.isOffRoute && nav.destination && gps.fix) {
            // Reroute
            nav.setIsCalculating(true)
            wsRef.current?.send({
              type: 'command',
              action: 'calculate_route',
              fromLon: gps.fix.longitude,
              fromLat: gps.fix.latitude,
              toLon: nav.destination.longitude,
              toLat: nav.destination.latitude,
            })
          }
        }, REROUTE_DELAY_MS)
      } else if (!state.isOffRoute && prev.isOffRoute) {
        // Clear reroute timer
        if (rerouteTimerRef.current) {
          clearTimeout(rerouteTimerRef.current)
          rerouteTimerRef.current = null
        }
      }
    })

    return unsub
  }, [])
}

/**
 * Send a geocode search query via the navigation WebSocket.
 */
export function sendGeocodeSearch(client: GpsWebSocketClient, query: string, lat?: number, lon?: number): void {
  client.send({
    type: 'command',
    action: 'geocode_search',
    query,
    nearLat: lat,
    nearLon: lon,
  })
}

/**
 * Send a route calculation request via the navigation WebSocket.
 */
export function sendCalculateRoute(
  client: GpsWebSocketClient,
  fromLon: number, fromLat: number,
  toLon: number, toLat: number
): void {
  client.send({
    type: 'command',
    action: 'calculate_route',
    fromLon, fromLat, toLon, toLat,
  })
}
