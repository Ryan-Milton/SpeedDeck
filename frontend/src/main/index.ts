import { app, BrowserWindow, ipcMain, net, powerSaveBlocker, dialog, protocol } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { PythonManager } from './python-manager'
import { writeFile } from 'fs/promises'

// SteamOS/Gamescope requires --no-sandbox for non-Steam Electron apps
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}

let mainWindow: BrowserWindow | null = null
let pythonManager: PythonManager | null = null
let powerBlockerId: number | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: !is.dev,
    frame: is.dev,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (is.dev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.speeddeck')

  // Register protocol for serving local map resources (PMTiles, style JSON)
  protocol.handle('local-resource', (request) => {
    const url = new URL(request.url)
    const resourcePath = is.dev
      ? join(__dirname, '../../resources', url.pathname)
      : join(process.resourcesPath, url.pathname)
    return net.fetch(pathToFileURL(resourcePath).toString())
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Prevent display sleep while app is running
  powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')

  // Start Python backend
  pythonManager = new PythonManager()
  try {
    await pythonManager.start()
    console.log('Python backend started')
  } catch (err) {
    console.error('Failed to start Python backend:', err)
    // Continue anyway — frontend can show connection error
  }

  // IPC handlers
  ipcMain.handle('get-ws-url', () => {
    return pythonManager?.wsUrl ?? 'ws://127.0.0.1:8765'
  })

  ipcMain.handle('get-backend-status', () => {
    return { running: pythonManager?.running ?? false }
  })

  ipcMain.handle('toggle-fullscreen', () => {
    if (mainWindow) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
    }
  })

  ipcMain.handle('show-save-dialog', async () => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      filters: [{ name: 'GPX Files', extensions: ['gpx'] }],
      defaultPath: 'trip.gpx'
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('save-file', async (_event, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8')
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', async () => {
  if (powerBlockerId !== null) {
    powerSaveBlocker.stop(powerBlockerId)
  }
  if (pythonManager) {
    pythonManager.stop()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})
