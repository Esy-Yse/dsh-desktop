const { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync, statSync } = require('node:fs')
const { basename, dirname, resolve } = require('node:path')
const asar = require('@electron/asar')

const desktopRoot = resolve(__dirname, '..')
const source = resolve(desktopRoot, 'source')
const archive = resolve(desktopRoot, '..', 'resources', 'app.asar')
const backup = `${archive}.bak`

if (!existsSync(source)) throw new Error(`Launcher source is missing: ${source}`)

const stage = mkdtempSync(resolve(dirname(archive), 'app.asar.build-'))
const output = resolve(stage, basename(archive))

try {
  cpSync(source, resolve(stage, 'app'), { recursive: true })
  asar.createPackage(resolve(stage, 'app'), output).then(() => {
    if (statSync(output).size === 0) throw new Error('Packed launcher archive is empty')
    if (!existsSync(backup)) copyFileSync(archive, backup)
    // Windows may reject rename-overwrite even after Electron exits. The
    // original archive is preserved in .bak before this copy, so replacing
    // the file in place keeps the portable layout stable without relying on
    // platform-specific rename semantics.
    copyFileSync(output, archive)
    console.log(`Packed ${archive}; backup: ${backup}`)
  }).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} finally {
  process.on('exit', () => { rmSync(stage, { recursive: true, force: true }) })
}
