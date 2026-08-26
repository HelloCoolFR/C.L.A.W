const fs = require('fs')
const path = require('path')

fs.copyFileSync(
  path.join(__dirname, 'electron', 'ai-worker.mjs'),
  path.join(__dirname, 'dist-electron', 'ai-worker.mjs')
)

const icons = ['icon.png', 'icon.ico', 'tray-icon.png']
for (const icon of icons) {
  const src = path.join(__dirname, icon)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(__dirname, 'dist-electron', icon))
  }
}

console.log('Electron build completed successfully!')

