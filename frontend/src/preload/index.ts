import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getWsUrl: (): Promise<string> => ipcRenderer.invoke('get-ws-url'),
  getBackendStatus: (): Promise<{ running: boolean }> => ipcRenderer.invoke('get-backend-status'),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke('toggle-fullscreen'),
  showSaveDialog: (): Promise<string | null> => ipcRenderer.invoke('show-save-dialog'),
  saveFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('save-file', filePath, content),

  // Tile management
  checkTilesExist: (): Promise<boolean> => ipcRenderer.invoke('check-tiles-exist'),
  getCacheSize: (): Promise<number> => ipcRenderer.invoke('get-cache-size'),
  estimateTileDownload: (
    bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
    minZoom: number,
    maxZoom: number
  ): Promise<{ tileCount: number; estimatedSizeMB: number }> =>
    ipcRenderer.invoke('estimate-tile-download', bbox, minZoom, maxZoom),
  startTileDownload: (
    bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
    minZoom: number,
    maxZoom: number
  ): Promise<boolean> =>
    ipcRenderer.invoke('start-tile-download', bbox, minZoom, maxZoom),
  cancelTileDownload: (): Promise<void> => ipcRenderer.invoke('cancel-tile-download'),
  getTileDownloadProgress: (): Promise<{ downloaded: number; total: number; percent: number }> =>
    ipcRenderer.invoke('get-tile-download-progress'),
  deleteCachedTiles: (): Promise<boolean> => ipcRenderer.invoke('delete-cached-tiles'),
  onTileDownloadProgress: (
    callback: (progress: { downloaded: number; total: number; percent: number }) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { downloaded: number; total: number; percent: number }): void => {
      callback(progress)
    }
    ipcRenderer.on('tile-download-progress', handler)
    return (): void => {
      ipcRenderer.removeListener('tile-download-progress', handler)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-expect-error fallback for non-isolated context
  window.api = api
}
