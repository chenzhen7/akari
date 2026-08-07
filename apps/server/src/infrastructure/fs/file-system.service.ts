import { mkdir, access, constants, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { FileNode } from '@akari/shared-types'

export interface IFileSystemService {
  listFiles(cwd: string, relativePath: string): Promise<FileNode[]>
  readFileContent(cwd: string, filePath: string): Promise<string>
  writeFileContent(cwd: string, filePath: string, content: string): Promise<void>
  createDirectory(cwd: string, dirPath: string): Promise<void>
  createFile(cwd: string, filePath: string): Promise<void>
  renamePath(cwd: string, fromPath: string, toPath: string): Promise<void>
  deletePath(cwd: string, targetPath: string): Promise<void>
  resolveFilePath(filePath: string, cwd: string): Promise<string>
  resolveWritePath(filePath: string, cwd: string): string
  assertPathInWorktree(worktreePath: string, filePath: string): string
  getWorktreePath(sessionId: string): string
}

export class FileSystemService implements IFileSystemService {
  constructor(
    private readonly repoRoot: string,
    private readonly workspacePath: string,
    private readonly worktreeBaseDir: string,
  ) {}

  private get workspaceOffset(): string {
    return relative(this.repoRoot, this.workspacePath).replace(/\\/g, '/')
  }

  private isAgentWorktree(cwd: string): boolean {
    return resolve(cwd).startsWith(resolve(this.worktreeBaseDir) + sep)
  }

  async resolveFilePath(filePath: string, cwd: string): Promise<string> {
    const normalized = filePath.replace(/\\/g, '/')
    if (this.isAgentWorktree(cwd)) {
      return join(cwd, normalized)
    }
    const offset = this.workspaceOffset
    if (offset && (normalized === offset || normalized.startsWith(offset + '/'))) {
      return join(this.repoRoot, normalized)
    }
    // Prefer workspace-relative if the file exists there.
    const workspaceAbsolute = join(this.workspacePath, normalized)
    try {
      await access(workspaceAbsolute, constants.F_OK)
      return workspaceAbsolute
    } catch {
      return join(this.repoRoot, normalized)
    }
  }

  resolveWritePath(filePath: string, cwd: string): string {
    const normalized = filePath.replace(/\\/g, '/')
    if (this.isAgentWorktree(cwd)) {
      return join(cwd, normalized)
    }
    const offset = this.workspaceOffset
    if (offset && (normalized === offset || normalized.startsWith(offset + '/'))) {
      return join(this.repoRoot, normalized)
    }
    return join(this.workspacePath, normalized)
  }

  assertPathInWorktree(worktreePath: string, filePath: string): string {
    const resolvedFile = resolve(filePath)
    const allowedBase = this.isAgentWorktree(worktreePath) ? resolve(worktreePath) : resolve(this.repoRoot)
    const isInside = resolvedFile === allowedBase || resolvedFile.startsWith(allowedBase + sep)
    if (!isInside) {
      throw new Error(`invalid file path: ${filePath}`)
    }
    return resolvedFile
  }

  async listFiles(cwd: string, relativePath: string): Promise<FileNode[]> {
    const targetPath = join(cwd, relativePath)

    try {
      const entries = await readdir(targetPath, { withFileTypes: true })
      const filtered = entries.filter((entry) => {
        if (entry.name === 'node_modules') return false
        if (entry.name === '.git') return false
        if (entry.name === '.agent-worktrees') return false
        return true
      })

      const nodes: FileNode[] = filtered.map((entry) => ({
        name: entry.name,
        path: join(relativePath, entry.name).replace(/\\/g, '/'),
        type: entry.isDirectory() ? 'directory' : 'file',
      }))

      nodes.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name)
        return a.type === 'directory' ? -1 : 1
      })

      return nodes
    } catch {
      // Worktree not ready or directory doesn't exist — return empty list
      return []
    }
  }

  async readFileContent(cwd: string, filePath: string): Promise<string> {
    const fullPath = await this.resolveFilePath(filePath, cwd)

    const stats = await access(fullPath, constants.F_OK)
      .then(() => true)
      .catch(() => false)
    if (!stats) throw new Error(`File not found: ${filePath}`)

    return readFile(fullPath, 'utf8')
  }

  async writeFileContent(cwd: string, filePath: string, content: string): Promise<void> {
    const fullPath = this.resolveWritePath(filePath, cwd)

    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf8')
  }

  private async pathExists(filePath: string): Promise<boolean> {
    return access(filePath, constants.F_OK)
      .then(() => true)
      .catch(() => false)
  }

  private getAllowedBase(cwd: string): string {
    return this.isAgentWorktree(cwd) ? resolve(cwd) : resolve(this.repoRoot)
  }

  async createDirectory(cwd: string, dirPath: string): Promise<void> {
    const fullPath = this.resolveWritePath(dirPath, cwd)
    this.assertPathInWorktree(cwd, fullPath)
    if (await this.pathExists(fullPath)) throw new Error(`已存在同名文件或文件夹：${dirPath}`)
    await mkdir(fullPath, { recursive: true })
  }

  async createFile(cwd: string, filePath: string): Promise<void> {
    const fullPath = this.resolveWritePath(filePath, cwd)
    this.assertPathInWorktree(cwd, fullPath)
    if (await this.pathExists(fullPath)) throw new Error(`已存在同名文件或文件夹：${filePath}`)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, '', 'utf8')
  }

  async renamePath(cwd: string, fromPath: string, toPath: string): Promise<void> {
    const fullFrom = this.resolveWritePath(fromPath, cwd)
    const fullTo = this.resolveWritePath(toPath, cwd)
    this.assertPathInWorktree(cwd, fullFrom)
    this.assertPathInWorktree(cwd, fullTo)
    if (resolve(fullFrom) === this.getAllowedBase(cwd)) throw new Error('不能重命名根目录')
    if (fullFrom === fullTo) return
    if (!(await this.pathExists(fullFrom))) throw new Error(`文件或文件夹不存在：${fromPath}`)
    if (await this.pathExists(fullTo)) throw new Error(`已存在同名文件或文件夹：${toPath}`)
    await rename(fullFrom, fullTo)
  }

  async deletePath(cwd: string, targetPath: string): Promise<void> {
    const fullPath = this.resolveWritePath(targetPath, cwd)
    this.assertPathInWorktree(cwd, fullPath)
    if (resolve(fullPath) === this.getAllowedBase(cwd)) throw new Error('不能删除根目录')
    if (!(await this.pathExists(fullPath))) throw new Error(`文件或文件夹不存在：${targetPath}`)
    await rm(fullPath, { recursive: true })
  }

  getWorktreePath(sessionId: string): string {
    const repoSlug = basename(this.repoRoot)
    return join(this.worktreeBaseDir, repoSlug, sessionId)
  }
}
