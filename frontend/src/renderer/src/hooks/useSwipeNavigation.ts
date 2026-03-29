import { useEffect, useRef } from 'react'
import { useSettingsStore } from '../stores/settings-store'

const SWIPE_THRESHOLD = 80 // px
const SWIPE_MAX_TIME = 400 // ms
const EDGE_ZONE = 40 // px from screen edge

export function useSwipeNavigation(): void {
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null)

  useEffect(() => {
    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      touchRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() }
    }

    const onEnd = (e: TouchEvent): void => {
      if (!touchRef.current || e.changedTouches.length !== 1) return

      const touch = e.changedTouches[0]
      const start = touchRef.current
      touchRef.current = null

      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      const dt = Date.now() - start.t

      // Must be a quick horizontal swipe
      if (dt > SWIPE_MAX_TIME) return
      if (Math.abs(dx) < SWIPE_THRESHOLD) return
      if (Math.abs(dy) > Math.abs(dx) * 0.7) return // too vertical

      const viewMode = useSettingsStore.getState().viewMode

      if (viewMode === 'hud' && dx < 0) {
        // Swipe left on HUD → switch to map
        useSettingsStore.getState().setViewMode('map')
      } else if (viewMode === 'map' && dx > 0 && start.x < EDGE_ZONE) {
        // Swipe right from left edge on map → switch to HUD
        useSettingsStore.getState().setViewMode('hud')
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })

    return (): void => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [])
}
