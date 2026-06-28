import { ChildProcess, spawn } from 'child_process'
import { join } from 'path'
import { mkdirSync, existsSync, chmodSync } from 'fs'
import { createConnection } from 'net'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

export class PythonManager {
  private proc: ChildProcess | null = null
  private _wsUrl = 'ws://127.0.0.1:8765'

  get wsUrl(): string {
    return this._wsUrl
  }

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null
  }

  async start(): Promise<void> {
    // Check if a backend is already running on the port
    if (await this.isPortInUse(8765)) {
      console.log('[backend] Backend already running on port 8765, reusing it')
      return
    }

    // Data dir: writable location for trips.db and config
    const dataDir = is.dev
      ? join(__dirname, '../../..', 'data')
      : join(app.getPath('userData'), 'data')

    mkdirSync(dataDir, { recursive: true })

    if (is.dev) {
      const backendDir = join(__dirname, '../../..', 'backend')
      const args = ['-m', 'gps_speedometer', '--data-dir', dataDir, '--simulator']

      this.proc = spawn('python3', args, {
        cwd: backendDir,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } else {
      // Production: run the PyInstaller binary from resources
      const backendPath = join(process.resourcesPath, 'backend', 'gps-speedometer-backend')

      // Ensure the binary is executable (AppImage extraction can lose permissions)
      if (existsSync(backendPath)) {
        try { chmodSync(backendPath, 0o755) } catch { /* ignore */ }
      }

      const args = ['--data-dir', dataDir]

      this.proc = spawn(backendPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
      })
    }

    // Log output
    this.proc.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) console.log(`[backend] ${line}`)
    })

    this.proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim()
      if (line) console.error(`[backend] ${line}`)
    })

    this.proc.on('exit', (code) => {
      console.log(`[backend] Process exited with code ${code}`)
      this.proc = null
    })

    await this.waitForReady(10000)
  }

  stop(): void {
    if (!this.proc) return
    console.log('[backend] Sending SIGTERM...')
    this.proc.kill('SIGTERM')

    const timeout = setTimeout(() => {
      if (this.proc) {
        console.log('[backend] Force killing...')
        this.proc.kill('SIGKILL')
      }
    }, 5000)

    this.proc.on('exit', () => {
      clearTimeout(timeout)
    })
  }

  private isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ port, host: '127.0.0.1' })
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('error', () => {
        resolve(false)
      })
      socket.setTimeout(500, () => {
        socket.destroy()
        resolve(false)
      })
    })
  }

  private waitForReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        console.warn('[backend] Timed out waiting for WebSocket server, continuing...')
        resolve()
      }, timeoutMs)

      const onData = (data: Buffer): void => {
        const line = data.toString()
        if (line.includes('WebSocket server started')) {
          clearTimeout(timer)
          this.proc?.stdout?.off('data', onData)
          resolve()
        }
      }

      this.proc?.stdout?.on('data', onData)

      this.proc?.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Backend exited with code ${code} during startup`))
      })
    })
  }
}
