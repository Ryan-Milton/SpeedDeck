declare global {
  interface Window {
    api: {
      getWsUrl: () => Promise<string>
      getBackendStatus: () => Promise<{ running: boolean }>
      toggleFullscreen: () => Promise<void>
      showSaveDialog: () => Promise<string | null>
      saveFile: (filePath: string, content: string) => Promise<void>
    }
  }
}

export {}
