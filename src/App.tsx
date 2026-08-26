import { useState, useEffect, useRef } from 'react'
import Unknown, { type AnimationName } from '../claw-avatar/Unknown'

// Extend global window object with preload APIs
declare global {
  interface Window {
    clawAPI?: {
      openTaskManager: () => Promise<{ success: boolean; error?: string }>
      optimizePC: () => Promise<{ success: boolean; error?: string }>
      checkUpdates: () => Promise<{ updated: boolean; error?: string }>
      dragWindow: (dx: number, dy: number) => void
      startDrag: (filePath: string) => void
      readClipboard: () => Promise<string>
      onActiveEmotion: (callback: (data: { emotion: string; title: string }) => void) => void
      onAudioVolume: (callback: (volume: number) => void) => void
      getDesktopSourceId: () => Promise<string>
      sendVolume: (volume: number) => void
      getDiscordPings: () => Promise<Array<{ sender: string; body: string }>>
      fetchAICompletion: (config: { prompt: string }) => Promise<string>
      setWindowSize: (width: number, height: number) => Promise<void>
      minimizeToTray: () => void
      saveUpdateToken: (token: string) => Promise<{ success: boolean }>
      onUpdateStatus: (callback: (status: string) => void) => void
    }
  }
}

interface NoteFile {
  id: string
  name: string
  content: string
  isChecklist: boolean
  checkedLines: Record<number, boolean>
}


// ============================================================================
// DEVELOPER AI PROMPTS - structured format parsed by the embedded engine in electron/main.ts
// ============================================================================
export const MUSIC_COMMENT_PROMPT = (song: string, artist: string) =>
  `music comment\nSong: ${song}\nArtist: ${artist}`

export const WINDOW_REACTION_PROMPT = (title: string) =>
  `app reaction\nTitle: ${title}`

export const DISCORD_PING_SUMMARY_PROMPT = (mentionsList: string) =>
  `discord summary\nMentions: ${mentionsList}`
// ============================================================================


function parseMusicTitle(title: string): { song: string; artist: string } | null {
  let clean = title
    // Remove leading notification count like (327)
    .replace(/^\(\d+\)\s*/, '')
    // Remove YouTube/Spotify/Opera browser suffixes
    .replace(/[-|]\s*(YouTube|Spotify|Opera|Chrome|Firefox|Edge|Safari)\s*$/i, '')
    .replace(/[-|]\s*(YouTube|Spotify|Opera|Chrome|Firefox|Edge|Safari)\s*[-|]/i, ' - ')
    // Remove Topic channels
    .replace(/\s*-\s*Topic\s*$/i, '')
    // Remove quality tags
    .replace(/\[?(Official\s*)?(Music\s*)?(Video|Audio|Lyric[s]?|Visualizer|Clip|HD|HQ|MV|4K|Edit|Remix)\]?/gi, '')
    // Remove pipe + stuff after it (playlist names, channel names)
    .replace(/\|.*$/, '')
    // Remove double/triple dashes and clean up
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Split on " - " to get artist / song
  const parts = clean.split(/\s*-\s*/)
  if (parts.length >= 2) {
    const artist = parts[0].trim()
    const song = parts.slice(1).join(' - ').trim()
    // Reject if either part is too long or has junk chars (likely unparseable)
    if (artist.length > 40 || song.length > 60) return null
    if (/^\d+$/.test(artist)) return null
    return { artist, song }
  }

  // No dash — might be "Song by Artist" format
  const byMatch = clean.match(/^(.+?)\s+by\s+(.+)$/i)
  if (byMatch) return { song: byMatch[1].trim(), artist: byMatch[2].trim() }

  return null
}

async function fetchAICompletion(prompt: string): Promise<string> {
  if (window.clawAPI?.fetchAICompletion) {
    return await window.clawAPI.fetchAICompletion({ prompt } as any)
  }
  return '';
}

export default function App() {
  const [currentAnim, setCurrentAnim] = useState<AnimationName>('sleeping')
  const [avatarPlaying, setAvatarPlaying] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activePanel, setActivePanel] = useState<'agenda' | 'system' | 'notes' | 'calc' | 'clip' | 'pings' | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [isJiggling, setIsJiggling] = useState(false)
  const [loadingPings, setLoadingPings] = useState(false)
  const [pingSummary, setPingSummary] = useState('')
  const [devAudioVolume, setDevAudioVolume] = useState(0)
  const avatarWrapperRef = useRef<HTMLDivElement>(null)

  // Multi-File Notes state
  const [notesList, setNotesList] = useState<NoteFile[]>(() => {
    const saved = localStorage.getItem('claw_notes_list')
    return saved ? JSON.parse(saved) : [
      { id: '1', name: 'Note 1', content: 'Type some thoughts here...', isChecklist: false, checkedLines: {} }
    ]
  })
  const [activeNoteId, setActiveNoteId] = useState<string>(() => {
    return notesList[0]?.id || '1'
  })
  const activeNote = notesList.find(n => n.id === activeNoteId) || notesList[0]

  // Clipboard & Files state
  const [clipText, setClipText] = useState('')
  const [droppedFiles, setDroppedFiles] = useState<string[]>(() => {
    const saved = localStorage.getItem('claw_dropped_files')
    return saved ? JSON.parse(saved) : []
  })
  
  const [devMode, setDevMode] = useState(false)
  const [logs, setLogs] = useState<string[]>(['[System] Dev console active. Ready.'])
  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 80))
  }

  // Resize window when dev mode toggles
  useEffect(() => {
    if (window.clawAPI?.setWindowSize) {
      if (devMode) {
        window.clawAPI.setWindowSize(680, 480)
      } else {
        window.clawAPI.setWindowSize(320, 480)
      }
    }
  }, [devMode])
  
  const [detectedApp, setDetectedApp] = useState('')
  const [liveComment, setLiveComment] = useState<string | null>(null)
  // AI is handled entirely offline via local model in electron/main.ts
  
  // Calc states
  const [calcInput, setCalcInput] = useState('')
  const [calcResult, setCalcResult] = useState('')

  // Agenda states
  interface AgendaItem {
    id: string
    title: string
    time: string
  }
  const [agenda, setAgenda] = useState<AgendaItem[]>(() => {
    const saved = localStorage.getItem('claw_agenda')
    return saved ? JSON.parse(saved) : [
      { id: '1', title: 'Welcome to C.L.A.W', time: '10:00' },
      { id: '2', title: 'Review implementation plan', time: '14:30' }
    ]
  })
  const [newTitle, setNewTitle] = useState('')
  const [newTime, setNewTime] = useState('')

  // System states
  const [sysStatus, setSysStatus] = useState('Idle')

  // Inactivity tracking
  useEffect(() => {
    let timeout: NodeJS.Timeout
    const resetTimer = () => {
      clearTimeout(timeout)
      if (currentAnim !== 'sleeping' && currentAnim !== 'bored') {
        timeout = setTimeout(() => {
          setCurrentAnim('bored')
        }, 8000)
      }
    }
    window.addEventListener('click', resetTimer)
    window.addEventListener('keydown', resetTimer)
    resetTimer()
    return () => {
      clearTimeout(timeout)
      window.removeEventListener('click', resetTimer)
      window.removeEventListener('keydown', resetTimer)
    }
  }, [currentAnim])

  // Clipboard Polling
  useEffect(() => {
    const updateClipboard = async () => {
      if (window.clawAPI) {
        const text = await window.clawAPI.readClipboard()
        if (text && text !== clipText) {
          setClipText(text)
        }
      }
    }
    // Poll every 1.5 seconds
    const interval = setInterval(updateClipboard, 1500)
    return () => clearInterval(interval)
  }, [clipText])
  // Listen to active-emotion updates from Electron main process
  useEffect(() => {
    if (window.clawAPI?.onActiveEmotion) {
      window.clawAPI.onActiveEmotion(({ emotion, title }) => {
        setCurrentAnim(emotion as AnimationName)
        setDetectedApp(title)
        addLog(`App: "${title}" (Anim: ${emotion})`)
      })
    }
  }, [])

  useEffect(() => {
    if (window.clawAPI?.onUpdateStatus) {
      window.clawAPI.onUpdateStatus((status) => {
        setSysStatus(status)
        addLog(`[Update] Status: ${status}`)
        if (status.includes('error')) {
          setCurrentAnim('confused')
        } else if (status.includes('downloaded') || status.includes('up to date')) {
          setCurrentAnim('happy')
        } else {
          setCurrentAnim('working')
        }
      })
    }
  }, [])

  useEffect(() => {
    if (!detectedApp || detectedApp.toLowerCase().includes('c.l.a.w')) {
      setLiveComment(null)
      return
    }

    let active = true
    const handleComment = async () => {
      const music = parseMusicTitle(detectedApp)
      const promptText = music 
        ? MUSIC_COMMENT_PROMPT(music.song, music.artist) 
        : WINDOW_REACTION_PROMPT(detectedApp)
      
      addLog(`AI Query: ${music ? 'Music Comment' : 'App Reaction'} (Local Offline Model)`)
      const comment = await fetchAICompletion(promptText)
      addLog(`AI Response: "${comment || 'None'}"`)
      if (active && comment) {
        setLiveComment(comment)
      } else if (active) {
        setLiveComment(null)
      }
    }
    handleComment()

    const timer = setTimeout(() => {
      if (active) setLiveComment(null)
    }, 7000)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [detectedApp])

  useEffect(() => {
    let audioCtx: AudioContext | null = null
    let active = true
    let streamRef: MediaStream | null = null

    const initAudio = async () => {
      if (!window.clawAPI?.getDesktopSourceId) return
      try {
        const sourceId = await window.clawAPI.getDesktopSourceId()
        if (!sourceId) return

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          } as any,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxWidth: 1,
              maxHeight: 1,
              maxFrameRate: 1
            }
          } as any
        })

        if (!active) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        streamRef = stream

        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const sourceNode = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        sourceNode.connect(analyser)

        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)

        let currentVol = 0
        let lastSentTime = 0
        let lastSentVol = 0
        const decay = 0.58
        const bassHistory: number[] = []

        const update = () => {
          if (!active) return
          analyser.getByteFrequencyData(dataArray)
          
          let bassSum = 0
          const bassBins = 4
          for (let i = 0; i < bassBins; i++) {
            bassSum += dataArray[i]
          }
          const currentBass = bassSum / bassBins // 0 to 255
          
          // Maintain a 40-frame history window (~0.6s)
          bassHistory.push(currentBass)
          if (bassHistory.length > 40) {
            bassHistory.shift()
          }
          
          const avgBass = bassHistory.reduce((a, b) => a + b, 0) / (bassHistory.length || 1)
          
          // Beat impulse is triggered when current bass exceeds local average
          let impulse = 0
          if (currentBass > avgBass && avgBass > 10) {
            impulse = (currentBass - avgBass) / (255 - avgBass || 1)
            impulse = Math.pow(impulse, 1.2) * 1.5
          }
          
          if (impulse > currentVol) {
            currentVol = impulse
          } else {
            currentVol = currentVol * decay
          }
          
          if (currentBass < 5) {
            currentVol = 0
          }

          const vol = Math.min(currentVol, 1.0)
          if (avatarWrapperRef.current) {
            avatarWrapperRef.current.style.transform = `scale(${1 + vol * 0.4}) translateY(-${vol * 36}px)`
          }
          
          // Throttle IPC volume dispatch to max 10 times/sec to prevent IPC channel congestion
          const now = performance.now()
          if (now - lastSentTime > 120 || Math.abs(vol - lastSentVol) > 0.15) {
            lastSentTime = now
            lastSentVol = vol
            window.clawAPI?.sendVolume(vol)
            if (devMode) {
              setDevAudioVolume(vol)
            }
          }
          requestAnimationFrame(update)
        }
        update()
      } catch (err) {
        console.error('WebAudio visualizer error:', err)
      }
    }

    initAudio()

    return () => {
      active = false
      if (audioCtx) {
        audioCtx.close()
      }
      if (streamRef) {
        streamRef.getTracks().forEach(t => t.stop())
      }
    }
  }, [])
  // Save changes
  useEffect(() => {
    localStorage.setItem('claw_notes_list', JSON.stringify(notesList))
  }, [notesList])

  useEffect(() => {
    localStorage.setItem('claw_dropped_files', JSON.stringify(droppedFiles))
  }, [droppedFiles])

  useEffect(() => {
    localStorage.setItem('claw_agenda', JSON.stringify(agenda))
  }, [agenda])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) { // Right click to drag
      let lastX = e.screenX
      let lastY = e.screenY

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.screenX - lastX
        const dy = moveEvent.screenY - lastY
        lastX = moveEvent.screenX
        lastY = moveEvent.screenY
        if (dx !== 0 || dy !== 0) {
          window.clawAPI?.dragWindow(dx, dy)
        }
      }

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }
  }

  const handleAvatarClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (currentAnim === 'sleeping') {
      setCurrentAnim('waking')
      setAvatarPlaying(true)
      setTimeout(() => {
        setCurrentAnim('idle')
        setMenuOpen(true)
      }, 1200)
    } else {
      setMenuOpen(prev => !prev)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  const fetchDiscordPings = async () => {
    setLoadingPings(true)
    setCurrentAnim('thinking')
    addLog('Fetching Discord notifications from system listener...')
    if (window.clawAPI?.getDiscordPings) {
      const list = await window.clawAPI.getDiscordPings()
      addLog(`Found ${list.length} missed Discord notification(s).`)
      if (list.length === 0) {
        setPingSummary("You don't have any missed Discord pings or mentions. You're all caught up! ✨")
      } else {
        addLog('Querying local AI for mentions summary...')
        const promptText = DISCORD_PING_SUMMARY_PROMPT(JSON.stringify(list))
        let summaryText = await fetchAICompletion(promptText)
        addLog(`AI Summary received: "${summaryText ? summaryText.substring(0, 40) + '...' : 'Failed'}"`)

        if (!summaryText) {
          addLog('AI summary empty. Falling back to structured bullet list...')
          const groups: Record<string, string[]> = {}
          for (const p of list) {
            if (!groups[p.sender]) groups[p.sender] = []
            groups[p.sender].push(p.body)
          }
          summaryText = `You have ${list.length} missed mention${list.length > 1 ? 's' : ''}:\n\n`
          for (const [sender, messages] of Object.entries(groups)) {
            summaryText += `• @${sender} pinged you ${messages.length} time${messages.length > 1 ? 's' : ''}.\n`
            const lastMsg = messages[messages.length - 1]
            if (lastMsg) {
              summaryText += `  Last message: "${lastMsg.length > 70 ? lastMsg.substring(0, 67) + '...' : lastMsg}"\n`
            }
          }
        }
        setPingSummary(summaryText)
      }
    } else {
      addLog('Querying simulated notifications (browser fallback)...')
      setPingSummary("Simulated Pings:\n• @John: 'Hey, are you ready?'\n• @Mary: 'Check out the update!'")
    }
    setLoadingPings(false)
    setCurrentAnim('idle')
  }

  const handleWheelSelect = (option: string) => {
    if (option === 'Close') {
      if (window.clawAPI?.minimizeToTray) {
        window.clawAPI.minimizeToTray()
      } else {
        window.close()
      }
      return
    }

    if (option === 'Pings') {
      setActivePanel('pings')
      setMenuOpen(false)
      fetchDiscordPings()
      return
    }

    if (option === 'Pat') {
      setIsJiggling(true)
      setCurrentAnim('happy')
      setTimeout(() => {
        setIsJiggling(false)
        setCurrentAnim('idle')
      }, 1500)
      return
    }

    let target = option.toLowerCase() as 'agenda' | 'system' | 'notes' | 'calc' | 'clip' | 'pings'
    if (option === 'Calculator') target = 'calc'
    setActivePanel(target)
    setMenuOpen(false)

    if (target === 'notes') {
      setCurrentAnim('listening')
    } else if (target === 'calc') {
      setCurrentAnim('thinking')
    } else if (target === 'system') {
      setCurrentAnim('working')
    } else if (target === 'agenda') {
      setCurrentAnim('thinking')
    } else if (target === 'clip') {
      setCurrentAnim('listening')
    }
  }

  // Multi-Notes actions
  const createNewNote = () => {
    const newNote: NoteFile = {
      id: Date.now().toString(),
      name: `Note ${notesList.length + 1}`,
      content: '',
      isChecklist: false,
      checkedLines: {}
    }
    setNotesList(prev => [...prev, newNote])
    setActiveNoteId(newNote.id)
  }

  const updateActiveNoteContent = (content: string) => {
    setNotesList(prev => prev.map(note => {
      if (note.id === activeNoteId) {
        return { ...note, content }
      }
      return note
    }))
  }

  const renameActiveNote = (newName: string) => {
    setNotesList(prev => prev.map(note => {
      if (note.id === activeNoteId) {
        return { ...note, name: newName }
      }
      return note
    }))
  }

  const toggleChecklistMode = () => {
    setNotesList(prev => prev.map(note => {
      if (note.id === activeNoteId) {
        return { ...note, isChecklist: !note.isChecklist }
      }
      return note
    }))
  }

  const toggleLineCheck = (lineIndex: number) => {
    setNotesList(prev => prev.map(note => {
      if (note.id === activeNoteId) {
        const nextChecks = { ...note.checkedLines }
        nextChecks[lineIndex] = !nextChecks[lineIndex]
        return { ...note, checkedLines: nextChecks }
      }
      return note
    }))
  }

  const deleteActiveNote = () => {
    if (notesList.length <= 1) return
    const remaining = notesList.filter(note => note.id !== activeNoteId)
    setNotesList(remaining)
    setActiveNoteId(remaining[0].id)
  }

  // Drag and Drop files
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const paths: string[] = []
      for (let i = 0; i < files.length; i++) {
        // In electron, files contain the absolute file system path
        const filePath = (files[i] as any).path || files[i].name
        paths.push(filePath)
      }
      setDroppedFiles(prev => Array.from(new Set([...prev, ...paths])))
      setCurrentAnim('happy')
    }
  }

  const handleDragStart = (e: React.DragEvent, path: string) => {
    e.preventDefault()
    window.clawAPI?.startDrag(path)
  }

  // Calc operations
  const handleCalcClick = (val: string) => {
    setCurrentAnim('thinking')
    if (val === '=') {
      try {
        let formatted = calcInput
          .replace(/π/g, 'Math.PI')
          .replace(/\be\b/g, 'Math.E')
          .replace(/sin\(/g, 'Math.sin(')
          .replace(/cos\(/g, 'Math.cos(')
          .replace(/tan\(/g, 'Math.tan(')
          .replace(/log\(/g, 'Math.log10(')
          .replace(/ln\(/g, 'Math.log(')
          .replace(/sqrt\(/g, 'Math.sqrt(')
          .replace(/\^/g, '**')

        const allowedMatch = formatted.match(/[^0-9+\-*/.() \t*]|Math\.(PI|E|sin|cos|tan|log10|log|sqrt)/g)
        const sanitised = (allowedMatch || []).reduce((acc, m) => {
          if (/^Math\.(PI|E|sin|cos|tan|log10|log|sqrt)$/.test(m)) return acc + m
          return acc
        }, formatted.replace(/[^0-9+\-*/.() \t*]/g, ''))

        // eslint-disable-next-line no-eval
        const res = eval(sanitised)
        setCalcResult(Number.isFinite(res) ? String(Number(res.toFixed(8))) : 'Error')
      } catch {
        setCalcResult('Error')
      }
    } else if (val === 'C') {
      setCalcInput('')
      setCalcResult('')
    } else if (val === 'del') {
      setCalcInput(prev => prev.slice(0, -1))
    } else {
      if (['sin', 'cos', 'tan', 'log', 'ln', 'sqrt'].includes(val)) {
        setCalcInput(prev => prev + val + '(')
      } else {
        setCalcInput(prev => prev + val)
      }
    }
  }

  // Agenda actions
  const addAgendaItem = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle || !newTime) return
    const item: AgendaItem = {
      id: Date.now().toString(),
      title: newTitle,
      time: newTime
    }
    setAgenda(prev => [...prev, item].sort((a, b) => a.time.localeCompare(b.time)))
    setNewTitle('')
    setNewTime('')
  }

  const deleteAgendaItem = (id: string) => {
    setAgenda(prev => prev.filter(item => item.id !== id))
  }

  // System optimization actions
  const runOptimize = async () => {
    setSysStatus('Optimizing...')
    setCurrentAnim('working')
    addLog('Initiating System Optimization...')
    if (window.clawAPI) {
      const res = await window.clawAPI.optimizePC()
      if (res.success) {
        setSysStatus('System Optimized!')
        addLog('Optimization complete: Temp files cleared + DNS flushed.')
        setCurrentAnim('happy')
      } else {
        setSysStatus(`Failed: ${res.error}`)
        addLog(`Optimization failed: ${res.error}`)
        setCurrentAnim('confused')
      }
    } else {
      setTimeout(() => {
        setSysStatus('Optimized (Simulated)')
        addLog('Optimization complete (Simulated environment).')
        setCurrentAnim('happy')
      }, 1500)
    }
  }

  const openTaskManager = async () => {
    setSysStatus('Opening Task Manager...')
    setCurrentAnim('working')
    addLog('Requesting OS Task Manager...')
    if (window.clawAPI) {
      const res = await window.clawAPI.openTaskManager()
      if (res.success) {
        setSysStatus('Task Manager Opened')
        addLog('Task Manager launched successfully.')
      } else {
        setSysStatus(`Error: ${res.error}`)
        addLog(`Task Manager launch failed: ${res.error}`)
      }
    } else {
      setSysStatus('Task Manager (Not available in browser)')
      addLog('Task Manager launch failed: browser mode active.')
    }
  }

  const checkUpdates = async () => {
    setSysStatus('Checking updates...')
    setCurrentAnim('working')
    if (window.clawAPI) {
      const res = await window.clawAPI.checkUpdates()
      if (res.updated) {
        setSysStatus('Files updated successfully!')
        setCurrentAnim('happy')
      } else if (res.error) {
        setSysStatus(`Update error: ${res.error}`)
        setCurrentAnim('confused')
      } else {
        setSysStatus('App is up to date')
        setCurrentAnim('happy')
      }
    } else {
      setTimeout(() => {
        setSysStatus('Up to date (Simulated)')
        setCurrentAnim('happy')
      }, 1000)
    }
  }

  // Radial positioning config (8 options)
  const radius = 115
  const wheelOptions = ['Agenda', 'System', 'Notes', 'Calculator', 'Pat', 'Clip', 'Pings', 'Close']

  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '0', height: '100vh', overflow: 'hidden' }}>
      <div className="app-container">
      {/* Radial Menu */}
      <div className={`radial-menu ${menuOpen ? 'open' : ''}`}>
        {wheelOptions.map((opt, i) => {
          const angle = (i * 2 * Math.PI) / 8 - Math.PI / 2
          const x = Math.cos(angle) * radius
          const y = Math.sin(angle) * radius
          return (
            <div
              key={opt}
              className="wheel-item"
              style={{
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${menuOpen ? 1 : 0})`,
                opacity: menuOpen ? 1 : 0,
                transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
                transitionDelay: menuOpen ? `${i * 30}ms` : '0ms'
              }}
            >
              <button
                className={`wheel-btn ${opt === 'Close' ? 'close-app-btn' : ''} ${opt === 'Pings' ? 'pings-menu-btn' : ''}`}
                onClick={() => handleWheelSelect(opt)}
              >
                {opt}
              </button>
            </div>
          )
        })}
      </div>

      {/* Live Comment Speech Bubble */}
      {liveComment && (
        <div className="speech-bubble">
          {liveComment}
        </div>
      )}

      {/* Avatar Container */}
      <div
        ref={avatarWrapperRef}
        className={`avatar-wrapper ${isJiggling ? 'jiggle' : ''}`}
        onMouseDown={handleMouseDown}
        onClick={handleAvatarClick}
        onContextMenu={handleContextMenu}
      >
        <Unknown animation={currentAnim} playing={avatarPlaying} size={110} />
      </div>

      {/* Dynamic Panels */}
      {activePanel === 'agenda' && (
        <div className="overlay-panel">
          <div className="panel-header">
            <span className="panel-title">Agenda</span>
            <button className="close-panel-btn" onClick={() => { setActivePanel(null); setCurrentAnim('idle') }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '100px', overflowY: 'auto', marginBottom: '8px' }}>
            {agenda.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', padding: '5px', borderRadius: '4px', fontSize: '11px' }}>
                <span>[{item.time}] {item.title}</span>
                <span style={{ color: '#ff5f56', cursor: 'pointer' }} onClick={() => deleteAgendaItem(item.id)}>✕</span>
              </div>
            ))}
          </div>
          <form onSubmit={addAgendaItem} style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
            <input type="text" placeholder="Title" value={newTitle} onChange={e => { setNewTitle(e.target.value); setCurrentAnim('thinking') }} style={{ flex: 1 }} />
            <input type="text" placeholder="12:00" value={newTime} onChange={e => { setNewTime(e.target.value); setCurrentAnim('thinking') }} style={{ width: '48px' }} />
            <button type="submit" style={{ padding: '4px 8px', background: 'var(--accent)', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}>+</button>
          </form>
          <button className="action-btn secondary" style={{ fontSize: '11px', padding: '5px' }} onClick={() => alert('Connect Google Calendar API client in settings.')}>Connect Google Agenda</button>
        </div>
      )}

      {activePanel === 'notes' && activeNote && (
        <div className="overlay-panel notes-panel">
          <div className="panel-header">
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <select
                value={activeNoteId}
                onChange={e => setActiveNoteId(e.target.value)}
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border)', color: 'white', fontSize: '10px', borderRadius: '4px', padding: '2px' }}
              >
                {notesList.map(n => (
                  <option key={n.id} value={n.id} style={{ background: '#1e1e2f', color: 'white' }}>{n.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={activeNote.name}
                onChange={e => renameActiveNote(e.target.value)}
                style={{ width: '62px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border)', color: 'white', fontSize: '10px', borderRadius: '4px', padding: '2px 4px' }}
                placeholder="Name"
              />
              <button onClick={createNewNote} style={{ background: 'var(--accent)', border: 'none', color: 'white', borderRadius: '4px', padding: '2px 4px', fontSize: '10px', cursor: 'pointer' }}>+</button>
              <button onClick={deleteActiveNote} style={{ background: 'transparent', border: 'none', color: '#ff5f56', fontSize: '10px', cursor: 'pointer' }}>Del</button>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={toggleChecklistMode} style={{ background: activeNote.isChecklist ? 'var(--accent)' : 'rgba(255,255,255,0.05)', border: '1px solid var(--panel-border)', color: 'white', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', cursor: 'pointer' }}>
                Checklist
              </button>
              <button className="close-panel-btn" onClick={() => { setActivePanel(null); setCurrentAnim('idle') }}>✕</button>
            </div>
          </div>

          {activeNote.isChecklist ? (
            <div className="checklist-container" style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto' }}>
              {(activeNote.content.split('\n') || []).map((line, idx) => {
                if (!line.trim()) return null
                return (
                  <label key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={!!activeNote.checkedLines[idx]}
                      onChange={() => toggleLineCheck(idx)}
                      style={{ width: 'auto' }}
                    />
                    <span style={{ textDecoration: activeNote.checkedLines[idx] ? 'line-through' : 'none', color: activeNote.checkedLines[idx] ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                      {line}
                    </span>
                  </label>
                )
              })}
              <button
                className="action-btn secondary"
                style={{ fontSize: '11px', padding: '4px', marginTop: '6px' }}
                onClick={() => {
                  const item = prompt('Enter TODO item:')
                  if (item) {
                    updateActiveNoteContent(activeNote.content + (activeNote.content ? '\n' : '') + item)
                  }
                }}
              >
                + Add Item
              </button>
            </div>
          ) : (
            <textarea
              style={{ width: '100%', height: '110px', background: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--panel-border)', borderRadius: '6px', color: 'var(--text-primary)', padding: '6px', fontSize: '12px', resize: 'none' }}
              placeholder="Write note here..."
              value={activeNote.content}
              onChange={e => {
                updateActiveNoteContent(e.target.value)
                setCurrentAnim('listening')
              }}
            />
          )}
        </div>
      )}

      {activePanel === 'calc' && (
        <div className="overlay-panel">
          <div className="panel-header">
            <span className="panel-title">Calculator</span>
            <button className="close-panel-btn" onClick={() => { setActivePanel(null); setCurrentAnim('idle') }}>✕</button>
          </div>
          <div className="calc-screen">{calcResult || calcInput || '0'}</div>
          <div className="calc-grid">
            {[
              'sin', 'cos', 'tan', 'log', 'ln',
              'sqrt', '^', '(', ')', 'del',
              '7', '8', '9', '/', 'C',
              '4', '5', '6', '*', 'π',
              '1', '2', '3', '-', 'e',
              '0', '.', '%', '=', '+'
            ].map(btn => (
              <button
                key={btn}
                className={`calc-btn ${['/', '*', '-', '+', '=', 'del', 'C'].includes(btn) ? 'op' : ''}`}
                onClick={() => handleCalcClick(btn)}
              >
                {btn}
              </button>
            ))}
          </div>
        </div>
      )}

      {activePanel === 'system' && (
        <div className="overlay-panel">
          <div className="panel-header">
            <span className="panel-title">System Optimizer</span>
            <button className="close-panel-btn" onClick={() => { setActivePanel(null); setCurrentAnim('idle') }}>✕</button>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Status: {sysStatus}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button className="action-btn" onClick={runOptimize}>Optimize Computer</button>
            <button className="action-btn secondary" onClick={openTaskManager}>Open Task Manager</button>
            <button className="action-btn secondary" onClick={checkUpdates}>Check for Updates</button>
          </div>

          <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: 'var(--text-primary)', marginTop: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={devMode} onChange={e => setDevMode(e.target.checked)} style={{ width: 'auto' }} />
            <span>Enable Dev Mode</span>
          </label>
          {devMode && (
            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--panel-border)', borderRadius: '6px', padding: '8px', marginTop: '8px', fontSize: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ wordBreak: 'break-all' }}><span style={{ color: 'var(--accent)', fontWeight: 600 }}>Detected App:</span> {detectedApp || 'None'}</div>
              <div><span style={{ color: 'var(--accent)', fontWeight: 600 }}>Animation:</span> {currentAnim}</div>
              <div><span style={{ color: 'var(--accent)', fontWeight: 600 }}>Audio peak:</span> {(devAudioVolume * 100).toFixed(0)}%</div>
            </div>
          )}
        </div>
      )}

      {activePanel === 'clip' && (
        <div className="overlay-panel" onDragOver={e => e.preventDefault()} onDrop={handleFileDrop}>
          <div className="panel-header">
            <span className="panel-title">Clipboard & Files</span>
            <button className="close-panel-btn" onClick={() => { setActivePanel(null); setCurrentAnim('idle') }}>✕</button>
          </div>
          
          <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}>System Clipboard:</span>
          <textarea
            readOnly
            style={{ width: '100%', height: '55px', background: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--panel-border)', borderRadius: '6px', color: 'var(--text-secondary)', padding: '6px', fontSize: '11px', resize: 'none', marginBottom: '8px' }}
            value={clipText || 'System clipboard is empty'}
          />

          <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}>File Container (Drop here):</span>
          <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px dashed var(--panel-border)', borderRadius: '6px', padding: '6px', maxHeight: '75px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {droppedFiles.length === 0 ? (
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', textAlign: 'center', padding: '10px 0' }}>Slide files in</span>
            ) : (
              droppedFiles.map(path => {
                const name = path.split('\\').pop()?.split('/').pop() || path
                return (
                  <div
                    key={path}
                    draggable
                    onDragStart={e => handleDragStart(e, path)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--panel-border)', padding: '4px', borderRadius: '4px', fontSize: '10px', display: 'flex', justifyContent: 'space-between', cursor: 'grab' }}
                  >
                    <span title={path} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>📁 {name}</span>
                    <span style={{ color: '#ff5f56', cursor: 'pointer' }} onClick={() => setDroppedFiles(prev => prev.filter(f => f !== path))}>✕</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {activePanel === 'pings' && (
        <div className="overlay-panel">
          <div className="panel-header">
            <span className="panel-title">Discord Pings Summary</span>
            <button className="close-panel-btn" onClick={() => { setActivePanel(null); setCurrentAnim('idle') }}>✕</button>
          </div>
          {loadingPings ? (
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>
              Summarizing mentions...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: '8px',
                  padding: '10px',
                  fontSize: '11.5px',
                  lineHeight: '1.45',
                  whiteSpace: 'pre-wrap',
                  color: 'var(--text-primary)',
                  maxHeight: '130px',
                  overflowY: 'auto',
                  textAlign: 'left'
                }}
              >
                {pingSummary}
              </div>
              <button className="action-btn" onClick={fetchDiscordPings}>
                Refresh Summary
              </button>

              <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '6px', marginTop: '2px' }}>
                <button
                  className="action-btn secondary"
                  style={{ fontSize: '10px', padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', cursor: 'pointer' }}
                  onClick={() => setShowGuide(!showGuide)}
                >
                  <span>{showGuide ? 'Hide' : 'Show'} Notification Guide</span>
                  <span>{showGuide ? '▲' : '▼'}</span>
                </button>
                {showGuide && (
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '4px', textAlign: 'left', maxHeight: '100px', overflowY: 'auto' }}>
                    <div style={{ fontWeight: 600, color: 'var(--accent)' }}>1. Windows Settings:</div>
                    <div>• Go to <strong style={{ color: 'white' }}>Settings &gt; System &gt; Notifications</strong>.</div>
                    <div>• Turn ON <strong style={{ color: 'white' }}>Notifications</strong> globally.</div>
                    <div>• Find Discord under sender list and check <strong style={{ color: 'white' }}>Banners (Toasts)</strong> and <strong style={{ color: 'white' }}>Notification Center</strong>.</div>
                    <div style={{ fontWeight: 600, color: 'var(--accent)', marginTop: '4px' }}>2. Discord Settings:</div>
                    <div>• Open Discord, go to <strong style={{ color: 'white' }}>User Settings &gt; Notifications</strong>.</div>
                    <div>• Enable <strong style={{ color: 'white' }}>Desktop Notifications</strong>.</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      </div>{/* end app-container */}

      {devMode && (
        <div style={{
          width: '340px',
          height: '480px',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(10, 10, 15, 0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderLeft: '1px solid rgba(0, 255, 102, 0.15)',
          borderRadius: '0 16px 16px 0',
          padding: '12px',
          boxShadow: '4px 0 30px rgba(0,255,102,0.07)',
          flexShrink: 0,
          overflow: 'hidden',
        } as any}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ color: '#00ff66', fontFamily: 'Consolas, monospace', fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px' }}>⚡ C.L.A.W Console</span>
            <span style={{ fontSize: '9px', background: 'rgba(0,255,102,0.12)', color: '#00ff66', padding: '2px 6px', borderRadius: '4px', fontWeight: 700, letterSpacing: '1px' }}>DEV</span>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '10px', color: 'var(--text-secondary)', padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', marginBottom: '10px', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div><span style={{ color: '#00ff66', fontWeight: 700 }}>App: </span>{detectedApp ? (detectedApp.length > 22 ? detectedApp.substring(0, 19) + '…' : detectedApp) : '—'}</div>
            <div><span style={{ color: '#00ff66', fontWeight: 700 }}>Anim: </span>{currentAnim}</div>
            <div><span style={{ color: '#00ff66', fontWeight: 700 }}>Audio: </span>{(devAudioVolume * 100).toFixed(0)}%</div>
            <div><span style={{ color: '#00ff66', fontWeight: 700 }}>AI: </span>Local · Offline</div>
          </div>

          {/* Log stream */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', background: 'rgba(0,0,0,0.45)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {logs.map((log, idx) => (
              <div key={idx} style={{
                fontFamily: 'Consolas, monospace',
                fontSize: '9.5px',
                lineHeight: '1.4',
                wordBreak: 'break-all',
                color: log.includes('Response') || log.includes('Result') ? '#00ff66'
                  : log.includes('Error') || log.includes('failed') ? '#ff5f56'
                  : log.includes('AI Query') ? '#f5a623'
                  : 'rgba(200,200,220,0.85)'
              }}>
                {log}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
