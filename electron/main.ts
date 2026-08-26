import { app, BrowserWindow, ipcMain, clipboard, screen, desktopCapturer, Tray, Menu } from 'electron'
import { autoUpdater } from 'electron-updater'
import * as path from 'path'
import * as fs from 'fs'
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

function createWindow() {
  const iconPath = path.join(app.getAppPath(), 'icon.png')

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
  const iconPath = path.join(app.getAppPath(), 'icon.png')
  if (!fs.existsSync(iconPath)) return

  tray = new Tray(iconPath)
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


function getActiveWindowTitle(): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const script = `
        $def = '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);'
        $type = Add-Type -MemberDefinition $def -Name WinApi -Namespace WinApi -PassThru
        $hwnd = $type::GetForegroundWindow()
        $title = New-Object System.Text.StringBuilder 256
        $type::GetWindowText($hwnd, $title, 256) | Out-Null
        $title.ToString()
      `.trim()
      const base64 = Buffer.from(script, 'utf16le').toString('base64')
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${base64}`, (err, stdout) => {
        if (err) resolve('')
        else resolve(stdout.trim())
      })
    } else if (process.platform === 'linux') {
      exec('xdotool getwindowfocus getwindowname', (err, stdout) => {
        if (err) resolve('')
        else resolve(stdout.trim())
      })
    } else {
      resolve('')
    }
  })
}

app.whenReady().then(() => {
  setupPrivateUpdater()
  createWindow()
  createTray()

  // Check for updates and notify the user
  autoUpdater.checkForUpdatesAndNotify()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      createTray()
    }
  })

  // Start active window polling
  let lastEmotion = ''
  let lastTitle = ''
  setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const title = await getActiveWindowTitle()
    let emotion = ''

    if (title) {
      const lowerTitle = title.toLowerCase()
      if (lowerTitle.includes('youtube')) {
        // If sound is actively playing, set to listening
        if (currentPeakVolume > 0.02) {
          emotion = 'listening'
        } else {
          emotion = 'curious'
        }
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
      mainWindow.webContents.send('active-emotion', { emotion: currentEmotion, title })
    }
  }, 3000)
})

let currentPeakVolume = 0

ipcMain.on('send-volume', (event, volume) => {
  currentPeakVolume = volume
})

ipcMain.handle('get-desktop-source-id', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] })
  return sources[0]?.id || ''
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

ipcMain.handle('optimize-pc', async () => {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Clear temp directories and flush DNS
      exec('ipconfig /flushdns && del /q/f/s %TEMP%\\*', (err) => {
        if (err) resolve({ success: false, error: err.message })
        else resolve({ success: true })
      })
    } else {
      resolve({ success: true, message: 'Simulated optimization' })
    }
  })
})

// Dynamic update system: Checks a local directory "update" for updated files
ipcMain.handle('check-updates', async () => {
  const updateDir = path.join(app.getAppPath(), 'update')
  const distDir = path.join(app.getAppPath(), 'dist')
  if (fs.existsSync(updateDir)) {
    try {
      const files = fs.readdirSync(updateDir)
      if (files.length > 0) {
        // Copy files from update to dist
        for (const file of files) {
          fs.copyFileSync(path.join(updateDir, file), path.join(distDir, file))
        }
        return { updated: true }
      }
    } catch (e: any) {
      return { updated: false, error: e.message }
    }
  }
  return { updated: false }
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
        if ($app -eq "Discord") {
          $binding = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.NotificationTemplateNames]::ToastGeneric)
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

// â”€â”€ Embedded Context-Aware Comment Engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

const MUSIC_OPENERS = [
  'This beat is {vibe}!', 'Oh {artist}? Solid taste.',
  'That drop hits {adverb}.', 'You always find the {adj} tracks.',
  '{artist} goes {adverb} in this one.', 'Good pick â€” {song} is {adj}.',
  'The vibe on {song} is incredibly {adj}.', 'This one slaps {adverb}.',
  'Love the energy on {song}.', '{artist} delivering again.',
]
const VIBES = ['electric','raw','infectious','hypnotic','smooth','intense','crisp','immaculate','wild','lush']
const ADVERBS = ['hard','different','crazy','beautifully','perfectly','insanely well']
const ADJS = ['rare','underrated','elite','certified','flawless','perfect','top-tier','immaculate']

const GENRE_HINTS: Record<string, string[]> = {
  'lofi':   ['So chill right now.', 'Perfect focus music.', 'Lo-fi mode activated.'],
  'edm':    ['Drop incoming!', 'That bass line is crazy.', 'Going full energy mode.'],
  'rap':    ['The bars on this one are real.', 'Flow is immaculate here.', 'Lyrics locked in.'],
  'jazz':   ['Sophisticated choice.', 'Jazz brain activated.', 'Smooth as always.'],
  'rock':   ['Rocking out I see.', 'That guitar riff is fire.', 'Classic energy.'],
  'classic':['Old school taste.', 'Timeless pick.', 'Legendary vibes.'],
  'pop':    ['Certified banger.', 'Catchy as always.', 'Can\'t get this out of my head.'],
  'metal':  ['Going heavy today!', 'That riff is brutal (in the best way).', 'Full intensity mode.'],
  'ambient':['Zoning out? Good call.', 'Ambient mode on.', 'Deep focus unlocked.'],
}

const APP_COMMENTS: Record<string, string[]> = {
  'code':     ['Debugging mode detected.', 'In the zone â€” nice.', 'Focus level: developer.', 'Coding session ongoing.'],
  'visual':   ['Getting creative I see.', 'Art mode activated.', 'Design is looking sharp.'],
  'game':     ['Gaming session spotted!', 'Let\'s go, get that W.', 'GG incoming.', 'No distractions now.'],
  'browser':  ['Surfing the web?', 'Research mode engaged.', 'Down the rabbit hole again?'],
  'discord':  ['Chatting away?', 'Socials open, I see.', 'Keeping up with the crew.'],
  'video':    ['Watching something good?', 'Cinema mode activated.', 'Eyes glued to the screen.'],
  'word':     ['Writing something great?', 'Document mode on.', 'The words will come.'],
  'excel':    ['Spreadsheet hours.', 'Number crunching detected.', 'Data doesn\'t lie.'],
  'terminal': ['Terminal open â€” power user detected.', 'Command line? Respect.', 'Shell game strong.'],
  'spotify':  ['Spotify vibes only.', 'Good playlist choice.', 'Music taste confirmed.'],
  'youtube':  ['YouTube rabbit hole incoming?', 'What are we watching?', 'Algorithm delivered again.'],
}

function generateSmartComment(prompt: string): string {
  const p = prompt.toLowerCase()

  // Music comment branch
  if (p.includes('song:') || p.includes('artist:') || p.includes('music')) {
    const songMatch = prompt.match(/song:\s*"?([^"]+)"?/i)
    const artistMatch = prompt.match(/artist:\s*"?([^"]+)"?/i)
    const song = songMatch?.[1]?.trim() || 'this track'
    const artist = artistMatch?.[1]?.trim() || 'them'

    // Check genre keywords
    const combined = (song + ' ' + artist).toLowerCase()
    for (const [kw, lines] of Object.entries(GENRE_HINTS)) {
      if (combined.includes(kw)) return pick(lines)
    }

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
      if (pings.length === 0) return "You're all caught up on Discord! âœ¨"
      const senders = [...new Set(pings.map(p => p.sender))]
      if (senders.length === 1) {
        const msgs = pings.map(p => p.body).filter(Boolean)
        return `${senders[0]} pinged you ${pings.length} time${pings.length > 1 ? 's' : ''}. Last: "${msgs[msgs.length - 1]?.substring(0, 50) || 'â€¦'}"`
      }
      return `${senders.slice(0, 3).join(', ')} pinged you â€” ${pings.length} total mention${pings.length > 1 ? 's' : ''} waiting.`
    } catch { return 'Some Discord pings are waiting for you.' }
  }

  // App reaction branch
  for (const [kw, lines] of Object.entries(APP_COMMENTS)) {
    if (p.includes(kw)) return pick(lines)
  }

  // Generic fallback pool - return empty string if no smart rule matches
  return ''
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

