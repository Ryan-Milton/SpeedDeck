import { useEffect, useRef, useCallback, useState } from 'react'
import { useNavigationStore } from '../../stores/navigation-store'
import { useGpsStore } from '../../stores/gps-store'
import { GpsWebSocketClient } from '../../lib/ws-client'
import { convertDistance, distanceUnitLabel } from '../../lib/utils'
import { useSettingsStore } from '../../stores/settings-store'
import { X, MapPin, Building2, Route, Navigation, ArrowUpDown } from 'lucide-react'
import { Card } from '../shared/Card'
import type { SearchResult } from '../../types/navigation'

const WS_URL = 'ws://127.0.0.1:8765'

const CATEGORY_ICON = {
  city: Building2,
  road: Route,
  address: MapPin,
  poi: Navigation,
} as const

export function SearchOverlay(): React.JSX.Element | null {
  const isOpen = useNavigationStore((s) => s.isSearchOpen)
  const results = useNavigationStore((s) => s.searchResults)
  const setSearchOpen = useNavigationStore((s) => s.setSearchOpen)
  const setSearchQuery = useNavigationStore((s) => s.setSearchQuery)
  const setDestination = useNavigationStore((s) => s.setDestination)
  const setOrigin = useNavigationStore((s) => s.setOrigin)
  const setIsCalculating = useNavigationStore((s) => s.setIsCalculating)
  const unit = useSettingsStore((s) => s.speedUnit)

  const toInputRef = useRef<HTMLInputElement>(null)
  const fromInputRef = useRef<HTMLInputElement>(null)
  const wsRef = useRef<GpsWebSocketClient | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [activeField, setActiveField] = useState<'from' | 'to'>('to')
  const [fromQuery, setFromQuery] = useState('')
  const [toQuery, setToQuery] = useState('')
  const [fromLocation, setFromLocation] = useState<SearchResult | null>(null)

  const hasFix = useGpsStore((s) => s.fix !== null && s.fix.fixQuality > 0)

  useEffect(() => {
    const client = new GpsWebSocketClient(WS_URL)
    wsRef.current = client

    client.onMessage = (msg): void => {
      const data = msg as Record<string, unknown>
      if (data.type === 'geocodeResults') {
        useNavigationStore.getState().setSearchResults(
          (data as { results: typeof results }).results
        )
      } else if (data.type === 'routeData') {
        useNavigationStore.getState().setRoute(
          (data as { route: import('../../types/navigation').RouteData }).route
        )
        useNavigationStore.getState().setIsCalculating(false)
      }
    }

    client.connect()
    return (): void => client.disconnect()
  }, [])

  // Auto-focus the active input
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (activeField === 'to') toInputRef.current?.focus()
        else fromInputRef.current?.focus()
      }, 100)
    }
  }, [isOpen, activeField])

  // Reset state when overlay opens
  useEffect(() => {
    if (isOpen) {
      setFromQuery('')
      setToQuery('')
      setFromLocation(null)
      setActiveField('to')
      useNavigationStore.getState().setSearchResults([])
    }
  }, [isOpen])

  const doSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 2) return

    debounceRef.current = setTimeout(() => {
      const fix = useGpsStore.getState().fix
      wsRef.current?.send({
        type: 'command',
        action: 'geocode_search',
        query,
        nearLat: fix?.latitude,
        nearLon: fix?.longitude,
      })
    }, 200)
  }, [])

  const handleFromInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setFromQuery(query)
    setFromLocation(null) // clear selection when typing
    setActiveField('from')
    doSearch(query)
  }, [doSearch])

  const handleToInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setToQuery(query)
    setSearchQuery(query)
    setActiveField('to')
    doSearch(query)
  }, [doSearch, setSearchQuery])

  const handleSelectResult = useCallback((result: SearchResult) => {
    if (activeField === 'from') {
      // Set as starting location
      setFromLocation(result)
      setFromQuery(result.name)
      setOrigin(result)
      useNavigationStore.getState().setSearchResults([])
      // Switch focus to To field
      setActiveField('to')
      setTimeout(() => toInputRef.current?.focus(), 50)
    } else {
      // Set as destination and calculate route
      setDestination(result)
      setToQuery(result.name)

      // Determine origin coordinates
      const from = fromLocation
      const fix = useGpsStore.getState().fix

      let fromLon: number | null = null
      let fromLat: number | null = null

      if (from) {
        fromLon = from.longitude
        fromLat = from.latitude
      } else if (fix) {
        fromLon = fix.longitude
        fromLat = fix.latitude
      }

      if (fromLon !== null && fromLat !== null) {
        setSearchOpen(false)
        setIsCalculating(true)
        wsRef.current?.send({
          type: 'command',
          action: 'calculate_route',
          fromLon,
          fromLat,
          toLon: result.longitude,
          toLat: result.latitude,
        })
      }
    }
  }, [activeField, fromLocation, setDestination, setOrigin, setSearchOpen, setIsCalculating])

  const handleSwap = useCallback(() => {
    const oldFrom = fromLocation
    const oldFromQuery = fromQuery
    const oldToQuery = toQuery

    // Swap the queries and locations
    setFromQuery(oldToQuery)
    setToQuery(oldFromQuery)
    setFromLocation(null) // will need to re-select
    useNavigationStore.getState().setSearchResults([])
  }, [fromLocation, fromQuery, toQuery])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-surface flex flex-col" style={{ zIndex: 65 }}>
      {/* Header with From/To fields */}
      <div className="border-b border-separator">
        {/* Close button row */}
        <div className="flex items-center h-12 px-4">
          <button
            onClick={() => setSearchOpen(false)}
            className="w-10 h-10 flex items-center justify-center text-text-secondary active:text-accent transition-colors"
          >
            <X size={24} />
          </button>
          <span className="text-lg font-semibold text-text-primary ml-2">Directions</span>
        </div>

        {/* From / To fields */}
        <div className="flex items-stretch px-4 pb-3 gap-2">
          {/* Dots + swap button column */}
          <div className="flex flex-col items-center justify-center gap-1 py-1">
            <div className="w-3 h-3 rounded-full bg-accent" />
            <button onClick={handleSwap} className="text-text-tertiary active:text-accent p-0.5">
              <ArrowUpDown size={14} />
            </button>
            <div className="w-3 h-3 rounded-full bg-danger" />
          </div>

          {/* Input fields column */}
          <div className="flex-1 flex flex-col gap-2">
            <input
              ref={fromInputRef}
              type="text"
              value={fromLocation ? fromLocation.name : fromQuery}
              onChange={handleFromInput}
              onFocus={() => setActiveField('from')}
              placeholder={hasFix ? 'My Location' : 'Enter starting address...'}
              className={`h-11 rounded-xl px-4 text-sm text-text-primary placeholder:text-text-tertiary outline-none transition-colors ${
                activeField === 'from' ? 'bg-surface-card ring-1 ring-accent' : 'bg-surface-card'
              }`}
            />
            <input
              ref={toInputRef}
              type="text"
              value={toQuery}
              onChange={handleToInput}
              onFocus={() => setActiveField('to')}
              placeholder="Where to?"
              className={`h-11 rounded-xl px-4 text-sm text-text-primary placeholder:text-text-tertiary outline-none transition-colors ${
                activeField === 'to' ? 'bg-surface-card ring-1 ring-accent' : 'bg-surface-card'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {results.length === 0 && (activeField === 'to' ? toQuery : fromQuery).length >= 2 && (
          <p className="text-text-secondary text-sm text-center py-8">No results found</p>
        )}

        {results.map((result, i) => {
          const Icon = CATEGORY_ICON[result.category as keyof typeof CATEGORY_ICON] || MapPin
          const distDisplay = result.distance
            ? `${convertDistance(result.distance, unit).toFixed(1)} ${distanceUnitLabel(unit)}`
            : null

          return (
            <Card key={i} padding="sm" onClick={() => handleSelectResult(result)} className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-surface-active flex items-center justify-center text-text-secondary">
                <Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text-primary truncate">{result.name}</div>
                <div className="text-xs text-text-secondary capitalize">{result.category}</div>
              </div>
              {distDisplay && (
                <span className="text-xs text-text-secondary tabular-nums shrink-0">{distDisplay}</span>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
