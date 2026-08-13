#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
process.chdir(resolve(__dirname, '..'))

function parseArgs(argv) {
  const type = argv.find((arg) => /^(patch|minor|major)$/.test(arg)) ?? 'patch'
  const dryRun = argv.includes('--dry-run') || argv.includes('-d')
  return { type, dryRun }
}

function incVersion(version, type) {
  const parts = version.split('.').map((part) => parseInt(part, 10))
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`invalid version: ${version}`)
  }
  if (type === 'major') {
    return `${parts[0] + 1}.0.0`
  }
  if (type === 'minor') {
    return `${parts[0]}.${parts[1] + 1}.0`
  }
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
}

async function findPackageJsonFiles() {
  const entries = await readdir('.', { recursive: true, withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name !== 'package.json') continue
    const fullPath = resolve(entry.parentPath ?? entry.path, entry.name)
    if (fullPath.includes('node_modules')) continue
    if (fullPath.includes('.git')) continue
    if (fullPath.includes('dist')) continue
    if (fullPath.includes('.agent-worktrees')) continue
    files.push(fullPath)
  }
  return files
}

async function bump() {
  const { type, dryRun } = parseArgs(process.argv.slice(2))

  const rootPkgRaw = await readFile('package.json', 'utf8')
  const rootPkg = JSON.parse(rootPkgRaw)
  const currentVersion = rootPkg.version
  const nextVersion = incVersion(currentVersion, type)

  console.log(`Bumping workspace version: ${currentVersion} → ${nextVersion}`)

  const files = await findPackageJsonFiles()
  console.log(`Updating ${files.length} package.json files:`)
  for (const file of files) {
    const raw = await readFile(file, 'utf8')
    const pkg = JSON.parse(raw)
    const oldVersion = pkg.version
    pkg.version = nextVersion
    if (!dryRun) {
      await writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`)
    }
    console.log(`  ${file}: ${oldVersion} → ${nextVersion}`)
  }

  if (dryRun) {
    console.log('Dry run: no files written')
  } else {
    console.log(`\nVersion bumped to ${nextVersion}. Review the changes, then commit/tag manually:`)
    console.log('  git add -A')
    console.log(`  git commit -m "chore: bump version to ${nextVersion}"`)
    console.log(`  git tag v${nextVersion}`)
    console.log('  git push origin master --tags')
  }
}

bump().catch((err) => {
  console.error(err)
  process.exit(1)
})
