declare global {
  interface Window {
    api: {
      getWsUrl: () => Promise<string>
      getBackendStatus: () => Promise<{ running: boolean }>
      toggleFullscreen: () => Promise<void>
      showSaveDialog: (defaultFilename?: string) => Promise<string | null>
      saveFile: (filePath: string, content: string) => Promise<void>

      // Tile management
      checkTilesExist: () => Promise<boolean>
      getCacheSize: () => Promise<number>
      estimateTileDownload: (
        bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
        minZoom: number,
        maxZoom: number
      ) => Promise<{ tileCount: number; estimatedSizeMB: number }>
      startTileDownload: (
        bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
        minZoom: number,
        maxZoom: number
      ) => Promise<boolean>
      cancelTileDownload: () => Promise<void>
      getTileDownloadProgress: () => Promise<{ downloaded: number; total: number; percent: number }>
      deleteCachedTiles: () => Promise<boolean>
      onTileDownloadProgress: (
        callback: (progress: { downloaded: number; total: number; percent: number }) => void
      ) => () => void
    }
  }
}

export {}
