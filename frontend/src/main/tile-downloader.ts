import { join } from 'path'
import { mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'fs'
import { writeFile } from 'fs/promises'
import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'

const TILE_SERVERS = [
  'https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1',
  'https://tiles-b.basemaps.cartocdn.com/vectortiles/carto.streets/v1',
  'https://tiles-c.basemaps.cartocdn.com/vectortiles/carto.streets/v1',
  'https://tiles-d.basemaps.cartocdn.com/vectortiles/carto.streets/v1'
]

const CONCURRENCY = 6
const AVG_TILE_SIZE_KB = 5

export interface BBox {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

export interface TileEstimate {
  tileCount: number
  estimatedSizeMB: number
}

export interface DownloadProgress {
  downloaded: number
  total: number
  percent: number
}

export function getCacheDir(): string {
  return is.dev
    ? join(__dirname, '../../..', 'data', 'map-cache')
    : join(app.getPath('userData'), 'map-cache')
}

export function tilesExist(): boolean {
  const dir = getCacheDir()
  if (!existsSync(dir)) return false
  try {
    const entries = readdirSync(dir)
    return entries.some((e) => /^\d+$/.test(e))
  } catch {
    return false
  }
}

export function getCacheSize(): number {
  const dir = getCacheDir()
  if (!existsSync(dir)) return 0
  return getDirSize(dir)
}

function getDirSize(dirPath: string): number {
  let size = 0
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        size += getDirSize(fullPath)
      } else {
        size += statSync(fullPath).size
      }
    }
  } catch { /* ignore */ }
  return size
}

export function deleteCachedTiles(): void {
  const dir = getCacheDir()
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- Tile math (slippy map) ---

function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z))
}

function lat2tile(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z)
  )
}

function getTileRange(bbox: BBox, z: number): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const xMin = lon2tile(bbox.minLon, z)
  const xMax = lon2tile(bbox.maxLon, z)
  const yMin = lat2tile(bbox.maxLat, z) // Note: y is inverted (north = lower y)
  const yMax = lat2tile(bbox.minLat, z)
  return { xMin, xMax, yMin, yMax }
}

export function estimateDownload(bbox: BBox, minZoom: number, maxZoom: number): TileEstimate {
  let tileCount = 0
  for (let z = minZoom; z <= maxZoom; z++) {
    const { xMin, xMax, yMin, yMax } = getTileRange(bbox, z)
    tileCount += (xMax - xMin + 1) * (yMax - yMin + 1)
  }
  return {
    tileCount,
    estimatedSizeMB: Math.round((tileCount * AVG_TILE_SIZE_KB) / 1024 * 10) / 10
  }
}

// --- Download engine ---

let abortController: AbortController | null = null
let currentProgress: DownloadProgress = { downloaded: 0, total: 0, percent: 0 }

export function getDownloadProgress(): DownloadProgress {
  return currentProgress
}

export function cancelDownload(): void {
  abortController?.abort()
  abortController = null
}

export async function startDownload(
  bbox: BBox,
  minZoom: number,
  maxZoom: number
): Promise<boolean> {
  const cacheDir = getCacheDir()
  abortController = new AbortController()
  const { signal } = abortController

  // Build list of all tiles to download
  const tiles: { z: number; x: number; y: number }[] = []
  for (let z = minZoom; z <= maxZoom; z++) {
    const { xMin, xMax, yMin, yMax } = getTileRange(bbox, z)
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y })
      }
    }
  }

  currentProgress = { downloaded: 0, total: tiles.length, percent: 0 }

  // Download with concurrency limit
  let idx = 0
  let failed = 0

  const downloadNext = async (): Promise<void> => {
    while (idx < tiles.length) {
      if (signal.aborted) return

      const i = idx++
      const tile = tiles[i]
      const server = TILE_SERVERS[i % TILE_SERVERS.length]
      const url = `${server}/${tile.z}/${tile.x}/${tile.y}.mvt`
      const outDir = join(cacheDir, String(tile.z), String(tile.x))
      const outFile = join(outDir, `${tile.y}.mvt`)

      // Skip if already cached
      if (existsSync(outFile)) {
        currentProgress.downloaded++
        currentProgress.percent = Math.round((currentProgress.downloaded / currentProgress.total) * 100)
        continue
      }

      try {
        const resp = await fetch(url, { signal })
        if (!resp.ok) {
          failed++
          continue
        }
        const buffer = Buffer.from(await resp.arrayBuffer())
        mkdirSync(outDir, { recursive: true })
        await writeFile(outFile, buffer)
      } catch (err: unknown) {
        if (signal.aborted) return
        failed++
        continue
      }

      currentProgress.downloaded++
      currentProgress.percent = Math.round((currentProgress.downloaded / currentProgress.total) * 100)

      // Send progress to renderer
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.webContents.send('tile-download-progress', { ...currentProgress })
      }
    }
  }

  // Launch concurrent workers
  const workers = Array.from({ length: CONCURRENCY }, () => downloadNext())
  await Promise.all(workers)

  abortController = null

  if (signal.aborted) return false
  return failed < tiles.length * 0.1 // Success if <10% failures
}
