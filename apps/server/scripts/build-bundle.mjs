import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.resolve(__dirname, '..')
const outDir = path.join(projectDir, 'dist')
const outNodeModules = path.join(outDir, 'node_modules')

const EXTERNAL_PACKAGES = ['better-sqlite3', 'node-pty']

// Packages that are listed as dependencies but only used during install/build.
const EXCLUDED_PACKAGES = new Set([
  'prebuild-install',
  'node-gyp',
])

function resolvePackage(name, fromDir) {
  const packageJsonPath = require.resolve(path.join(name, 'package.json'), { paths: [fromDir] })
  return path.dirname(packageJsonPath)
}

function readPackageJson(dir) {
  const file = path.join(dir, 'package.json')
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: true })
}

function collectRuntimeDependencies(rootNames, fromDir) {
  const visited = new Set()
  const result = new Map()

  function visit(name, fromDir) {
    if (visited.has(name)) return
    visited.add(name)

    let packageDir
    try {
      packageDir = resolvePackage(name, fromDir)
    } catch (err) {
      console.warn(`[build-bundle] cannot resolve package ${name} from ${fromDir}, skipping`)
      return
    }

    const pkg = readPackageJson(packageDir)
    result.set(name, { dir: packageDir, version: pkg.version })

    const deps = {
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    }

    for (const depName of Object.keys(deps)) {
      if (EXCLUDED_PACKAGES.has(depName)) continue
      visit(depName, packageDir)
    }
  }

  for (const name of rootNames) {
    visit(name, fromDir)
  }

  return result
}

function runTsup() {
  console.log('[build-bundle] running tsup...')
  const result = spawnSync('pnpm', ['exec', 'tsup'], {
    cwd: projectDir,
    stdio: 'inherit',
    shell: true,
  })
  if (result.error) {
    throw new Error(`tsup spawn failed: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`tsup failed with exit code ${result.status}`)
  }
}

function copyExternalPackages() {
  console.log('[build-bundle] copying external packages...')
  fs.mkdirSync(outNodeModules, { recursive: true })

  const packages = collectRuntimeDependencies(EXTERNAL_PACKAGES, projectDir)

  for (const [name, { dir }] of packages) {
    const dest = path.join(outNodeModules, name)
    console.log(`[build-bundle] copying ${name}: ${dir} -> ${dest}`)
    copyDir(dir, dest)
  }
}

function writePackageJson() {
  const pkg = {
    name: '@akari/server',
    version: '0.0.1',
    type: 'module',
    main: 'index.js',
  }
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}

function main() {
  fs.rmSync(outDir, { recursive: true, force: true })
  runTsup()
  copyExternalPackages()
  writePackageJson()
  console.log('[build-bundle] done')
}

main()
