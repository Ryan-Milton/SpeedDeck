import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getWsUrl: (): Promise<string> => ipcRenderer.invoke('get-ws-url'),
  getBackendStatus: (): Promise<{ running: boolean }> => ipcRenderer.invoke('get-backend-status'),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke('toggle-fullscreen'),
  showSaveDialog: (): Promise<string | null> => ipcRenderer.invoke('show-save-dialog'),
  saveFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('save-file', filePath, content)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-expect-error fallback for non-isolated context
  window.api = api
}
