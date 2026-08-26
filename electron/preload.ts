import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('clawAPI', {
  openTaskManager: () => ipcRenderer.invoke('open-task-manager'),
  optimizePC: () => ipcRenderer.invoke('optimize-pc'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  dragWindow: (dx: number, dy: number) => ipcRenderer.send('drag-window', { dx, dy }),
  startDrag: (filePath: string) => ipcRenderer.send('start-drag', filePath),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  onActiveEmotion: (callback: (data: { emotion: string; title: string }) => void) => {
    ipcRenderer.on('active-emotion', (event, data) => callback(data))
  },
  onAudioVolume: (callback: (volume: number) => void) => {
    ipcRenderer.on('audio-volume', (event, volume) => callback(volume))
  },
  getDesktopSourceId: () => ipcRenderer.invoke('get-desktop-source-id'),
  sendVolume: (volume: number) => ipcRenderer.send('send-volume', volume),
  getDiscordPings: () => ipcRenderer.invoke('get-discord-pings'),
  fetchAICompletion: (config: any) => ipcRenderer.invoke('fetch-ai-completion', config),
  setWindowSize: (width: number, height: number) => ipcRenderer.invoke('set-window-size', { width, height }),
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  saveUpdateToken: (token: string) => ipcRenderer.invoke('save-update-token', token),
  onUpdateStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('update-status', (event, status) => callback(status))
  }
})
