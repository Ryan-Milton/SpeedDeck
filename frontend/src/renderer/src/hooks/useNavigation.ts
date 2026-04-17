import { useEffect, useRef } from 'react'
import { GpsWebSocketClient } from '../lib/ws-client'
import { useGpsStore } from '../stores/gps-store'
import { useNavigationStore } from '../stores/navigation-store'
import type { GeocodeResultsMessage, RouteDataMessage, NavStatusMessage } from '../types/navigation'

const WS_URL = 'ws://127.0.0.1:8765'
const MIN_REROUTE_DELAY_MS = 1500
const MAX_REROUTE_DELAY_MS = 4000
const REROUTE_DISTANCE_M = 40

function computeRerouteDelay(speedMps: number): number {
  if (speedMps < 1) return MAX_REROUTE_DELAY_MS
  const timeMs = (REROUTE_DISTANCE_M / speedMps) * 1000
  return Math.max(MIN_REROUTE_DELAY_MS, Math.min(MAX_REROUTE_DELAY_MS, timeMs))
}

export function useNavigation(): void {
  const wsRef = useRef<GpsWebSocketClient | null>(null)
  const rerouteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rerouteRetryCountRef = useRef<number>(0)

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
        rerouteRetryCountRef.current = 0
      } else if (data.type === 'navStatus') {
        const status = data as unknown as NavStatusMessage
        useNavigationStore.getState().setOsrmReady(status.routerRunning)
      } else if (data.type === 'navError') {
        useNavigationStore.getState().setIsCalculating(false)

        // Retry reroute with exponential backoff if still off-route
        const nav = useNavigationStore.getState()
        if (nav.isOffRoute && nav.status === 'navigating' && nav.destination) {
          const retryCount = rerouteRetryCountRef.current
          const MAX_REROUTE_RETRIES = 5
          if (retryCount < MAX_REROUTE_RETRIES && !rerouteTimerRef.current) {
            const backoffMs = 3000 * Math.pow(2, retryCount)
            rerouteRetryCountRef.current = retryCount + 1
            rerouteTimerRef.current = setTimeout(() => {
              rerouteTimerRef.current = null
              const navNow = useNavigationStore.getState()
              const gps = useGpsStore.getState()
              if (navNow.isOffRoute && navNow.destination && gps.fix) {
                navNow.setIsCalculating(true)
                wsRef.current?.send({
                  type: 'command',
                  action: 'calculate_route',
                  fromLon: gps.fix.longitude,
                  fromLat: gps.fix.latitude,
                  toLon: navNow.destination.longitude,
                  toLat: navNow.destination.latitude,
                  heading: gps.fix.heading,
                  speed: gps.smoothedSpeed,
                })
              }
            }, backoffMs)
          }
        }
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
        state.smoothedSpeed,
        state.fix.hdop
      )
    })

    return unsub
  }, [])

  // Watch for off-route and trigger reroute
  useEffect(() => {
    const unsub = useNavigationStore.subscribe((state, prev) => {
      if (state.isOffRoute && !prev.isOffRoute) {
        // Fresh off-route episode — reset retry count
        rerouteRetryCountRef.current = 0

        // Start reroute timer with speed-adaptive delay
        const currentSpeed = useGpsStore.getState().smoothedSpeed
        const delayMs = computeRerouteDelay(currentSpeed)

        rerouteTimerRef.current = setTimeout(() => {
          const nav = useNavigationStore.getState()
          const gps = useGpsStore.getState()
          if (nav.isOffRoute && nav.destination && gps.fix) {
            // Reroute with current heading and speed for bearing-aware routing
            nav.setIsCalculating(true)
            wsRef.current?.send({
              type: 'command',
              action: 'calculate_route',
              fromLon: gps.fix.longitude,
              fromLat: gps.fix.latitude,
              toLon: nav.destination.longitude,
              toLat: nav.destination.latitude,
              heading: gps.fix.heading,
              speed: gps.smoothedSpeed,
            })
          }
        }, delayMs)
      } else if (!state.isOffRoute && prev.isOffRoute) {
        // Clear reroute timer and reset retry count
        if (rerouteTimerRef.current) {
          clearTimeout(rerouteTimerRef.current)
          rerouteTimerRef.current = null
        }
        rerouteRetryCountRef.current = 0
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
 * Optional heading/speed enable bearing-constrained routing (for reroutes).
 */
export function sendCalculateRoute(
  client: GpsWebSocketClient,
  fromLon: number, fromLat: number,
  toLon: number, toLat: number,
  heading?: number,
  speed?: number,
): void {
  const msg: Record<string, unknown> = {
    type: 'command',
    action: 'calculate_route',
    fromLon, fromLat, toLon, toLat,
  }
  if (heading !== undefined) msg.heading = heading
  if (speed !== undefined) msg.speed = speed
  client.send(msg)
}
