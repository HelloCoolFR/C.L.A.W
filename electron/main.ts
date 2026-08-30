import { app, BrowserWindow, ipcMain, clipboard, screen, desktopCapturer, Tray, Menu, nativeImage, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import * as path from 'path'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import { exec, spawn } from 'child_process'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function setupPrivateUpdater() {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (config.githubToken) {
        autoUpdater.requestHeaders = {
          Authorization: `token ${config.githubToken}`
        }
      }
    } catch (e) {
      console.error('Failed to parse config.json:', e)
    }
  }
}

function getIconPath() {
  const isWin = process.platform === 'win32'
  const iconFile = isWin ? 'icon.ico' : 'icon.png'
  const primaryPath = app.isPackaged
    ? path.join(process.resourcesPath, iconFile)
    : path.join(app.getAppPath(), iconFile)
  
  if (fs.existsSync(primaryPath)) return primaryPath
  
  const fallback = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'icon.png')
  return fallback
}

function getTrayIcon(): Electron.NativeImage {
  const trayFile = 'tray-icon.png'
  const primaryPath = app.isPackaged
    ? path.join(process.resourcesPath, trayFile)
    : path.join(app.getAppPath(), trayFile)
  
  const targetPath = fs.existsSync(primaryPath) ? primaryPath : getIconPath()
  let image = nativeImage.createFromPath(targetPath)
  if (image.isEmpty()) {
    console.warn('[Tray] NativeImage is empty from:', targetPath)
  }
  return image.resize({ width: 24, height: 24 })
}

function createWindow() {
  const iconPath = getIconPath()

  mainWindow = new BrowserWindow({
    width: 320,
    height: 480,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true, // Don't show in the taskbar
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // Load from local build or dev server
  const distIndex = path.join(__dirname, '../dist/index.html')
  if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex)
  } else {
    mainWindow.loadURL('http://localhost:5173')
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Tray initialization
function createTray() {
  try {
    const icon = getTrayIcon()
    tray = new Tray(icon)
  } catch (err) {
    console.error('[Tray] Failed to create tray:', err)
    return
  }
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show C.L.A.W',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
        }
      }
    },
    {
      label: 'Hide C.L.A.W',
      click: () => {
        if (mainWindow) {
          mainWindow.hide()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit C.L.A.W',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setToolTip('C.L.A.W Companion')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
      }
    }
  })
}

ipcMain.on('minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide()
  }
})

ipcMain.handle('set-window-size', (_event, { width, height }: { width: number; height: number }) => {
  if (mainWindow) mainWindow.setSize(width, height)
})


let activeWindowProcess: any = null

function startActiveWindowWatcher() {
  if (process.platform !== 'win32') return

  try {
    const script = `
      $def = '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);'
      $type = Add-Type -MemberDefinition $def -Name WinApi -Namespace WinApi -PassThru
      $title = New-Object System.Text.StringBuilder 256
      while ($true) {
        $hwnd = $type::GetForegroundWindow()
        $title.Clear() | Out-Null
        $type::GetWindowText($hwnd, $title, 256) | Out-Null
        Write-Output "TITLE:$($title.ToString())"
        [System.Threading.Thread]::Sleep(3000)
      }
    `.trim()

    const base64 = Buffer.from(script, 'utf16le').toString('base64')
    activeWindowProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', base64])

    let lastEmotion = ''
    let lastTitle = ''

    activeWindowProcess.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/)
      for (const line of lines) {
        if (line.startsWith('TITLE:')) {
          const title = line.substring(6).trim()
          let emotion = ''
          if (title) {
            const lowerTitle = title.toLowerCase()
            if (lowerTitle.includes('youtube')) {
              emotion = currentPeakVolume > 0.02 ? 'listening' : 'curious'
            } else if (lowerTitle.includes('chrome') || lowerTitle.includes('firefox') || lowerTitle.includes('edge') || lowerTitle.includes('brave') || lowerTitle.includes('opera') || lowerTitle.includes('safari') || lowerTitle.includes('browser')) {
              emotion = 'searching'
            } else if (lowerTitle.includes('spotify') || lowerTitle.includes('vlc') || lowerTitle.includes('music') || lowerTitle.includes('soundcloud')) {
              emotion = 'listening'
            } else if (lowerTitle.includes('discord')) {
              emotion = 'shy'
            }
          }
          const currentEmotion = emotion || 'idle'
          if (currentEmotion !== lastEmotion || title !== lastTitle) {
            lastEmotion = currentEmotion
            lastTitle = title
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('active-emotion', { emotion: currentEmotion, title })
            }
          }
        }
      }
    })

    activeWindowProcess.on('exit', () => {
      activeWindowProcess = null
    })
  } catch (err) {
    console.error('Failed to start active window watcher:', err)
  }
}

app.whenReady().then(() => {
  setupPrivateUpdater()
  createWindow()
  createTray()
  startActiveWindowWatcher()

  // Configure autoUpdater logger
  autoUpdater.logger = console

  // Check for updates and notify the user on startup
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('autoUpdater startup error:', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      createTray()
    }
  })
})

let currentPeakVolume = 0

ipcMain.on('send-volume', (event, volume) => {
  currentPeakVolume = volume
})

ipcMain.handle('get-desktop-source-id', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] })
  return sources[0]?.id || ''
})

app.on('before-quit', () => {
  if (activeWindowProcess) {
    try { activeWindowProcess.kill() } catch {}
    activeWindowProcess = null
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// IPC commands for companion functions
ipcMain.on('drag-window', (event, { dx, dy }) => {
  if (mainWindow) {
    const [x, y] = mainWindow.getPosition()
    const [w, h] = mainWindow.getSize()
    let newX = x + dx
    let newY = y + dy

    const display = screen.getDisplayMatching(mainWindow.getBounds())
    const { x: sx, y: sy, width: sw, height: sh } = display.workArea

    if (newX < sx) newX = sx
    if (newY < sy) newY = sy
    if (newX + w > sx + sw) newX = sx + sw - w
    if (newY + h > sy + sh) newY = sy + sh - h

    mainWindow.setPosition(newX, newY)
  }
})

ipcMain.on('start-drag', (event, filePath) => {
  const iconPath = path.join(app.getPath('temp'), 'drag-icon.png')
  if (!fs.existsSync(iconPath)) {
    fs.writeFileSync(iconPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'))
  }
  if (fs.existsSync(filePath)) {
    event.sender.startDrag({
      file: filePath,
      icon: iconPath
    })
  }
})

ipcMain.handle('read-clipboard', () => {
  return clipboard.readText()
})

ipcMain.handle('open-task-manager', () => {
  if (process.platform === 'win32') {
    exec('taskmgr')
    return { success: true }
  } else if (process.platform === 'linux') {
    exec('gnome-system-monitor || xterm -e htop')
    return { success: true }
  }
  return { success: false, error: 'Unsupported platform' }
})

ipcMain.handle('run-optimization-task', async (_event, taskId: string) => {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ success: true, message: 'Simulated optimization' })
      return
    }

    let command = ''
    switch (taskId) {
      case 'temp_dns':
        command = 'ipconfig /flushdns & del /q /f /s %TEMP%\\* & del /q /f /s C:\\Windows\\Temp\\*'
        break
      case 'delivery_opt':
        command = 'net stop dosvc & del /q /f /s C:\\Windows\\SoftwareDistribution\\DeliveryOptimization\\* & net start dosvc'
        break
      case 'dism_cleanup':
        command = 'dism.exe /Online /Cleanup-Image /StartComponentCleanup'
        break
      case 'power_plan':
        command = 'powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61'
        break
      case 'registry_tweaks':
        command = 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects" /v VisualFXSettings /t REG_DWORD /d 2 /f & reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v SystemResponsiveness /t REG_DWORD /d 0 /f'
        break
      case 'telemetry_disable':
        command = 'sc config DiagTrack start=disabled & sc stop DiagTrack & sc config WerSvc start=disabled & sc stop WerSvc'
        break
      default:
        resolve({ success: false, error: 'Unknown optimization task' })
        return
    }

    // Run command, if error occurred it might be due to elevation restrictions but we proceed or report
    exec(command, (err) => {
      if (err) resolve({ success: false, error: err.message })
      else resolve({ success: true })
    })
  })
})

// Update check system: Queries GitHub Releases using electron-updater
ipcMain.handle('check-updates', async () => {
  try {
    setupPrivateUpdater()
    if (mainWindow) {
      mainWindow.webContents.send('update-status', 'Checking GitHub for updates...')
    }
    const result = await autoUpdater.checkForUpdates()
    const isNew = result && result.updateInfo.version !== app.getVersion()
    return { updated: isNew, version: result?.updateInfo?.version }
  } catch (e: any) {
    if (mainWindow) {
      mainWindow.webContents.send('update-status', `Update check failed: ${e.message}`)
    }
    return { updated: false, error: e.message }
  }
})

// autoUpdater status event forwarding
autoUpdater.on('update-available', () => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 'Update available. Downloading...')
  }
})

autoUpdater.on('update-not-available', () => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 'App is up to date')
  }
})

autoUpdater.on('update-downloaded', () => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 'Update downloaded. Restarting...')
  }
  setTimeout(() => {
    autoUpdater.quitAndInstall()
  }, 3000)
})

autoUpdater.on('error', (err) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', `Update error: ${err.message}`)
  }
})

function getDiscordPings(): Promise<Array<{ sender: string, body: string }>> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve([])
      return
    }

    const script = `
      Add-Type -AssemblyName 'System.Runtime.WindowsRuntime'
      [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
      $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
      $op = $listener.GetNotificationsAsync(1)
      $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
          $_.Name -eq 'AsTask' -and 
          $_.IsGenericMethod -and 
          $_.GetParameters().Length -eq 1 -and 
          $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation') 
      } | Select-Object -First 1
      $listType = [System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]]
      $asTaskConcrete = $asTaskGeneric.MakeGenericMethod($listType)
      $task = $asTaskConcrete.Invoke($null, @($op))
      $task.Wait()
      $notifications = $task.Result
      foreach ($n in $notifications) {
        $app = $n.AppInfo.DisplayInfo.DisplayName
        if ($app -like "*Discord*") {
          $binding = $n.Notification.Visual.GetBinding("ToastGeneric")
          if ($binding) {
            $texts = $binding.GetTextElements()
            $title = ""
            if ($texts.Count -gt 0) { $title = $texts[0].Text }
            $body = ""
            if ($texts.Count -gt 1) { $body = $texts[1].Text }
            Write-Output "PING:$title|$body"
          }
        }
      }
    `.trim()

    const base64 = Buffer.from(script, 'utf16le').toString('base64')
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${base64}`, (err, stdout) => {
      if (err) {
        resolve([])
        return
      }
      const pings: Array<{ sender: string, body: string }> = []
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        if (line.startsWith('PING:')) {
          const parts = line.substring(5).split('|')
          const sender = parts[0] || 'Unknown'
          const body = parts[1] || ''
          pings.push({ sender: sender.trim(), body: body.trim() })
        }
      }
      resolve(pings)
    })
  })
}
ipcMain.handle('get-discord-pings', async () => {
  return await getDiscordPings()
})

// ── Embedded Context-Aware Comment Engine ──────────────────────────────────────
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

const MUSIC_OPENERS = [
  'This beat is {vibe}!', 'Oh {artist}? Solid taste.',
  'That drop hits {adverb}.', 'You always find the {adj} tracks.',
  '{artist} goes {adverb} in this one.', 'Good pick — {song} is {adj}.',
  'The vibe on {song} is incredibly {adj}.', 'This one slaps {adverb}.',
  'Love the energy on {song}.', '{artist} delivering again.',
]
const VIBES = ['electric','raw','infectious','hypnotic','smooth','intense','crisp','immaculate','wild','lush']
const ADVERBS = ['hard','different','crazy','beautifully','perfectly','insanely well']
const ADJS = ['rare','underrated','elite','certified','flawless','perfect','top-tier','immaculate']

interface AppCategory {
  keywords: string[]
  comments: string[]
}

const CATEGORIES: Record<string, AppCategory> = {
  coding: {
    keywords: ['code', 'visual studio', 'vscode', 'intellij', 'pycharm', 'webstorm', 'cursor', 'sublime', 'neovim', 'vim', 'github', 'gitlab', 'terminal', 'powershell', 'cmd', 'bash', 'zsh', 'git', 'compiler', 'antigravity'],
    comments: [
      'Locking in on the code! 💻',
      'Focus level: developer ⚡',
      'Squashing bugs or building features? 🐛',
      'In the zone — clean code incoming.',
      'Coding session detected. Let\'s build something great!',
      'Terminal & editor active. Power user mode on 🔥'
    ]
  },
  browsing: {
    keywords: ['chrome', 'firefox', 'edge', 'brave', 'opera', 'safari', 'vivaldi', 'arc', 'google search', 'wikipedia', 'reddit', 'twitter', 'x.com', 'browser'],
    comments: [
      'Surfing the web? What rabbit hole are we down today? 🌐',
      'Research mode engaged 🔍',
      'Checking the latest news and updates! ✨',
      'Finding the answers to life\'s questions? 🧠',
      'Tabs on tabs — stay curious!'
    ]
  },
  gaming: {
    keywords: ['steam', 'epic games', 'game', 'minecraft', 'valorant', 'league', 'fortnite', 'roblox', 'overwatch', 'apex', 'counter-strike', 'cs2', 'gta', 'rpg', 'genshin', 'honkai', 'zelda', 'elden ring'],
    comments: [
      'Gaming session spotted! Get that W 🎮',
      'Locked in! No distractions, let\'s win this 🏆',
      'Game on! Focus mode activated 🔥',
      'GGs incoming! Have fun out there ✨'
    ]
  },
  creative: {
    keywords: ['figma', 'photoshop', 'illustrator', 'blender', 'premiere', 'after effects', 'canva', 'davinci', 'gimp', 'cinema 4d', 'unity', 'unreal'],
    comments: [
      'Creative brain activated! Making something beautiful 🎨',
      'Design & art mode on — looking sharp! ✨',
      'Pixel perfection in progress 🖌️',
      'Crafting visual magic right now 🪄'
    ]
  },
  media: {
    keywords: ['youtube', 'netflix', 'twitch', 'disney', 'hulu', 'anime', 'crunchyroll', 'prime video', 'vlc', 'mpv', 'movie', 'series'],
    comments: [
      'Watching something good? Popcorn time! 🍿',
      'Entertainment mode activated 🎬',
      'Chill session — enjoy the stream/video! ✨',
      'Catching up on some content 📺'
    ]
  },
  communication: {
    keywords: ['discord', 'slack', 'telegram', 'whatsapp', 'teams', 'messenger', 'signal', 'zoom', 'skype'],
    comments: [
      'Chatting with the squad? 💬',
      'Keeping up with the team & friends ✨',
      'Social mode on — say hi for me! 👋',
      'Messages coming in fast 📬'
    ]
  },
  productivity: {
    keywords: ['notion', 'obsidian', 'word', 'excel', 'powerpoint', 'docs', 'sheets', 'trello', 'jira', 'asana', 'onenote', 'todoist', 'calculator', 'notes'],
    comments: [
      'Organizing life & getting things done 📋',
      'Productivity mode: 100% 💼',
      'Structuring ideas like a pro ✨',
      'Focus session ongoing — you got this! 💪'
    ]
  },
  music: {
    keywords: ['spotify', 'soundcloud', 'apple music', 'tidal', 'deezer', 'music', 'bandcamp'],
    comments: [
      'Music vibes only 🎵',
      'Soundtrack to the grind! 🎧',
      'Vibing to the playlist ✨',
      'Good beats keep the momentum going 🎶'
    ]
  }
}

function generateSmartComment(prompt: string): string {
  const p = prompt.toLowerCase()

  // Music comment branch
  if (p.includes('song:') || p.includes('artist:') || p.includes('music comment')) {
    const songMatch = prompt.match(/song:\s*"?([^"]+)"?/i)
    const artistMatch = prompt.match(/artist:\s*"?([^"]+)"?/i)
    const song = songMatch?.[1]?.trim() || 'this track'
    const artist = artistMatch?.[1]?.trim() || 'them'

    // Template fill
    const template = pick(MUSIC_OPENERS)
    return template
      .replace('{song}', song)
      .replace('{artist}', artist)
      .replace('{vibe}', pick(VIBES))
      .replace('{adverb}', pick(ADVERBS))
      .replace('{adj}', pick(ADJS))
  }

  // Discord summary branch
  if (p.includes('discord summary')) {
    try {
      const mentionsRaw = prompt.match(/Mentions:\s*(.+)/s)?.[1] || '[]'
      const pings: Array<{ sender: string; body: string }> = JSON.parse(mentionsRaw)
      if (pings.length === 0) return "You're all caught up on Discord! ✨"
      const senders = [...new Set(pings.map(p => p.sender))]
      if (senders.length === 1) {
        const msgs = pings.map(p => p.body).filter(Boolean)
        return `${senders[0]} pinged you ${pings.length} time${pings.length > 1 ? 's' : ''}. Last: "${msgs[msgs.length - 1]?.substring(0, 50) || '…'}"`
      }
      return `${senders.slice(0, 3).join(', ')} pinged you — ${pings.length} total mention${pings.length > 1 ? 's' : ''} waiting.`
    } catch { return 'Some Discord pings are waiting for you.' }
  }

  // App reaction branch: Match against rich categories
  for (const category of Object.values(CATEGORIES)) {
    for (const keyword of category.keywords) {
      if (p.includes(keyword)) {
        return pick(category.comments)
      }
    }
  }

  // Contextual fallback for recognized window titles
  if (p.includes('title:')) {
    const title = prompt.split(/title:\s*/i)[1]?.trim() || ''
    if (title.length > 3) {
      const shortTitle = title.split(/[-|–—]/)[0].trim()
      const fallbackTemplates = [
        `Locked in on ${shortTitle} ✨`,
        `Focus mode: ${shortTitle} 🚀`,
        `Making progress on ${shortTitle} 💪`,
        `Working smoothly with ${shortTitle} ⚡`
      ]
      return pick(fallbackTemplates)
    }
  }

  return 'Keeping you company! ✨'
}

ipcMain.handle('fetch-ai-completion', async (event, { prompt }) => {
  const comment = generateSmartComment(prompt)
  console.log('[AI] Comment generated:', comment || '<None>')
  return comment
})

ipcMain.handle('save-update-token', (_event, token: string) => {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  const userDir = path.dirname(configPath)
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true })
  }
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    : {}
  config.githubToken = token
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

  autoUpdater.requestHeaders = {
    Authorization: `token ${token}`
  }
  return { success: true }
})

ipcMain.handle('save-notes', (_event, notesJson: string) => {
  try {
    const notesPath = path.join(app.getPath('userData'), 'notes.json')
    fs.writeFileSync(notesPath, notesJson, 'utf-8')
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('load-notes', () => {
  try {
    const notesPath = path.join(app.getPath('userData'), 'notes.json')
    if (fs.existsSync(notesPath)) {
      return { success: true, data: fs.readFileSync(notesPath, 'utf-8') }
    }
    return { success: true, data: null }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

// Google Calendar Integration
const configPath = path.join(app.getPath('userData'), 'config.json')

function getConfig() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch {}
  }
  return {}
}

function saveConfig(updated: any) {
  const current = getConfig()
  const next = { ...current, ...updated }
  const userDir = path.dirname(configPath)
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true })
  }
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf-8')
}

let oauthServer: http.Server | null = null

ipcMain.handle('save-google-credentials', (_event, { clientId, clientSecret }) => {
  saveConfig({ googleClientId: clientId, googleClientSecret: clientSecret })
  return { success: true }
})

ipcMain.handle('start-google-auth', async () => {
  const config = getConfig()
  const clientId = config.googleClientId
  const clientSecret = config.googleClientSecret

  if (!clientId || !clientSecret) {
    return { success: false, error: 'Please set Google Client ID & Client Secret in settings first.' }
  }

  if (oauthServer) {
    try { oauthServer.close() } catch {}
  }

  const port = 49152
  const redirectUri = `http://localhost:${port}/oauth-callback`

  return new Promise((resolve) => {
    oauthServer = http.createServer((req, res) => {
      const urlObj = new URL(req.url || '', `http://${req.headers.host}`)
      const code = urlObj.searchParams.get('code')

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h1>Authentication successful!</h1><p>You can close this tab and return to C.L.A.W.</p>')
        
        if (oauthServer) {
          oauthServer.close()
          oauthServer = null
        }

        exchangeAuthCode(code, clientId, clientSecret, redirectUri)
          .then((tokens) => {
            saveConfig({
              googleAccessToken: tokens.access_token,
              googleRefreshToken: tokens.refresh_token,
              googleTokenExpiry: Date.now() + (tokens.expires_in * 1000)
            })
            resolve({ success: true })
          })
          .catch((err) => {
            resolve({ success: false, error: err.message })
          })
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('No authorization code found.')
      }
    })

    oauthServer.listen(port, () => {
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly')}&access_type=offline&prompt=consent`
      shell.openExternal(authUrl)
    })
  })
})

function exchangeAuthCode(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const postData = `code=${encodeURIComponent(code)}&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&redirect_uri=${encodeURIComponent(redirectUri)}&grant_type=authorization_code`
    
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) reject(new Error(parsed.error_description || parsed.error))
          else resolve(parsed)
        } catch { reject(new Error('Failed to parse token response')) }
      })
    })

    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

async function getOrRefreshAccessToken(): Promise<string | null> {
  const config = getConfig()
  if (!config.googleRefreshToken) return null

  if (config.googleAccessToken && config.googleTokenExpiry && (config.googleTokenExpiry - Date.now() > 30000)) {
    return config.googleAccessToken
  }

  return new Promise((resolve) => {
    const postData = `client_id=${encodeURIComponent(config.googleClientId)}&client_secret=${encodeURIComponent(config.googleClientSecret)}&refresh_token=${encodeURIComponent(config.googleRefreshToken)}&grant_type=refresh_token`
    
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.access_token) {
            saveConfig({
              googleAccessToken: parsed.access_token,
              googleTokenExpiry: Date.now() + (parsed.expires_in * 1000)
            })
            resolve(parsed.access_token)
          } else resolve(null)
        } catch { resolve(null) }
      })
    })

    req.on('error', () => resolve(null))
    req.write(postData)
    req.end()
  })
}

ipcMain.handle('fetch-google-events', async () => {
  const accessToken = await getOrRefreshAccessToken()
  if (!accessToken) return { success: false, error: 'Not authenticated or failed to refresh token.' }

  return new Promise((resolve) => {
    const timeMin = new Date().toISOString()
    const url = `/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&maxResults=10&orderBy=startTime&singleEvents=true`
    
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: url,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) resolve({ success: false, error: parsed.error.message })
          else resolve({ success: true, events: parsed.items || [] })
        } catch { resolve({ success: false, error: 'Failed to parse calendar events response.' }) }
      })
    })

    req.on('error', (err) => resolve({ success: false, error: err.message }))
    req.end()
  })
})



