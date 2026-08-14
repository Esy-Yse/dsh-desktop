const { existsSync } = require('node:fs')
const { resolve } = require('node:path')
const asar = require('@electron/asar')

const desktopRoot = resolve(__dirname, '..')
const archive = resolve(desktopRoot, '..', 'resources', 'app.asar')
const destination = resolve(desktopRoot, 'source')

if (existsSync(destination)) {
  throw new Error(`Refusing to overwrite existing launcher source: ${destination}`)
}

asar.extractAll(archive, destination)
console.log(`Extracted ${archive} to ${destination}`)
