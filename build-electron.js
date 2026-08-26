const fs = require('fs')
const path = require('path')
fs.copyFileSync(
  path.join(__dirname, 'electron', 'ai-worker.mjs'),
  path.join(__dirname, 'dist-electron', 'ai-worker.mjs')
)
console.log('Electron build completed successfully!')

