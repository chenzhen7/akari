import { mkdir, access, constants, cp, lstat, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileNode } from '@akari/shared-types'
import { splitCopyName, buildCopyName } from './copy-name.js'

export interface IFileSystemService {
  listFiles(cwd: string, relativePath: string): Promise<FileNode[]>
  readFileContent(cwd: string, filePath: string): Promise<string>
  /** 二进制读取（markdown 预览里的相对图片等），路径同样经工作区边界校验 */
  readRawFile(cwd: string, filePath: string): Promise<Buffer>
  writeFileContent(cwd: string, filePath: string, content: string): Promise<void>
  /** 写入外部粘贴上传的二进制文件到 targetDir（重名自动加 copy 后缀），返回消解后的相对路径 */
  writeBinaryFile(cwd: string, targetDir: string, fileName: string, data: Buffer): Promise<string>
  createDirectory(cwd: string, dirPath: string): Promise<void>
  createFile(cwd: string, filePath: string): Promise<void>
  renamePath(cwd: string, fromPath: string, toPath: string): Promise<void>
  deletePath(cwd: string, targetPath: string): Promise<void>
  /** 复制 source 到 targetDir（保留源名，冲突自动加 copy 后缀），返回消解后的相对路径 */
  copyPath(cwd: string, source: string, targetDir: string): Promise<string>
  /** 移动 source 到 targetDir（冲突自动加 copy 后缀；同文件夹为 no-op），返回消解后的相对路径 */
  movePath(cwd: string, source: string, targetDir: string): Promise<string>
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
    const allowedBase = this.getAllowedBase(worktreePath)
    if (!this.isDescendantOrSelf(allowedBase, resolvedFile)) {
      throw new Error(`invalid file path: ${filePath}`)
    }
    return resolvedFile
  }

  async listFiles(cwd: string, relativePath: string): Promise<FileNode[]> {
    const targetPath = join(cwd, relativePath)
    await this.assertCanonicalPathInWorktree(cwd, targetPath)

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
    await this.assertCanonicalPathInWorktree(cwd, fullPath)

    const stats = await access(fullPath, constants.F_OK)
      .then(() => true)
      .catch(() => false)
    if (!stats) throw new Error(`File not found: ${filePath}`)

    return readFile(fullPath, 'utf8')
  }

  async readRawFile(cwd: string, filePath: string): Promise<Buffer> {
    const fullPath = await this.resolveFilePath(filePath, cwd)
    await this.assertCanonicalPathInWorktree(cwd, fullPath)

    const stats = await access(fullPath, constants.F_OK)
      .then(() => true)
      .catch(() => false)
    if (!stats) throw new Error(`File not found: ${filePath}`)

    return readFile(fullPath)
  }

  async writeFileContent(cwd: string, filePath: string, content: string): Promise<void> {
    const fullPath = this.resolveWritePath(filePath, cwd)
    await this.assertCanonicalPathInWorktree(cwd, fullPath)

    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf8')
  }

  async writeBinaryFile(cwd: string, targetDir: string, fileName: string, data: Buffer): Promise<string> {
    this.assertFileName(fileName)
    const destFull = await this.resolveUniquePath(cwd, targetDir, fileName, false)
    await this.assertCanonicalPathInWorktree(cwd, destFull)
    await mkdir(dirname(destFull), { recursive: true })
    await writeFile(destFull, data)
    return this.toRelPath(cwd, destFull)
  }

  private async pathExists(filePath: string): Promise<boolean> {
    return access(filePath, constants.F_OK)
      .then(() => true)
      .catch(() => false)
  }

  private async pathEntryExists(filePath: string): Promise<boolean> {
    return lstat(filePath)
      .then(() => true)
      .catch(() => false)
  }

  private getAllowedBase(cwd: string): string {
    return this.isAgentWorktree(cwd) ? resolve(cwd) : resolve(this.repoRoot)
  }

  private assertFileName(fileName: string): void {
    if (!fileName || fileName === '.' || fileName === '..' || fileName.includes('/') || fileName.includes('\\') || fileName.includes('\0')) {
      throw new Error(`invalid file name: ${fileName}`)
    }
  }

  /**
   * Lexical validation blocks `..` and absolute-path escapes. Resolving the
   * nearest existing ancestor also blocks symlinks (including broken links)
   * that would redirect a later read or write outside the allowed root.
   */
  private async assertCanonicalPathInWorktree(cwd: string, filePath: string): Promise<string> {
    const resolvedFile = this.assertPathInWorktree(cwd, filePath)
    const allowedBase = this.getAllowedBase(cwd)
    const canonicalBase = await realpath(allowedBase)

    let existingAncestor = resolvedFile
    while (!(await this.pathEntryExists(existingAncestor))) {
      const parent = dirname(existingAncestor)
      if (parent === existingAncestor || !this.isDescendantOrSelf(allowedBase, parent)) {
        throw new Error(`invalid file path: ${filePath}`)
      }
      existingAncestor = parent
    }

    let canonicalAncestor: string
    try {
      canonicalAncestor = await realpath(existingAncestor)
    } catch {
      throw new Error(`invalid file path: ${filePath}`)
    }
    if (!this.isDescendantOrSelf(canonicalBase, canonicalAncestor)) {
      throw new Error(`invalid file path: ${filePath}`)
    }
    return resolvedFile
  }

  async createDirectory(cwd: string, dirPath: string): Promise<void> {
    const fullPath = this.resolveWritePath(dirPath, cwd)
    await this.assertCanonicalPathInWorktree(cwd, fullPath)
    if (await this.pathExists(fullPath)) throw new Error(`已存在同名文件或文件夹：${dirPath}`)
    await mkdir(fullPath, { recursive: true })
  }

  async createFile(cwd: string, filePath: string): Promise<void> {
    const fullPath = this.resolveWritePath(filePath, cwd)
    await this.assertCanonicalPathInWorktree(cwd, fullPath)
    if (await this.pathExists(fullPath)) throw new Error(`已存在同名文件或文件夹：${filePath}`)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, '', 'utf8')
  }

  async renamePath(cwd: string, fromPath: string, toPath: string): Promise<void> {
    const fullFrom = this.resolveWritePath(fromPath, cwd)
    const fullTo = this.resolveWritePath(toPath, cwd)
    await this.assertCanonicalPathInWorktree(cwd, fullFrom)
    await this.assertCanonicalPathInWorktree(cwd, fullTo)
    if (resolve(fullFrom) === this.getAllowedBase(cwd)) throw new Error('不能重命名根目录')
    if (fullFrom === fullTo) return
    if (!(await this.pathExists(fullFrom))) throw new Error(`文件或文件夹不存在：${fromPath}`)
    if (await this.pathExists(fullTo)) throw new Error(`已存在同名文件或文件夹：${toPath}`)
    await rename(fullFrom, fullTo)
  }

  async deletePath(cwd: string, targetPath: string): Promise<void> {
    const fullPath = this.resolveWritePath(targetPath, cwd)
    await this.assertCanonicalPathInWorktree(cwd, fullPath)
    if (resolve(fullPath) === this.getAllowedBase(cwd)) throw new Error('不能删除根目录')
    if (!(await this.pathExists(fullPath))) throw new Error(`文件或文件夹不存在：${targetPath}`)
    await rm(fullPath, { recursive: true })
  }

  /** childAbs 是否等于 parentAbs 或在其内部（含自身） */
  private isDescendantOrSelf(parentAbs: string, childAbs: string): boolean {
    const p = resolve(parentAbs)
    const c = resolve(childAbs)
    const fromParent = relative(p, c)
    return fromParent === ''
      || (!isAbsolute(fromParent) && fromParent !== '..' && !fromParent.startsWith(`..${sep}`))
  }

  /** 目标名已存在时循环加 copy 后缀，返回真实 FS 上不存在的目标绝对路径 */
  private async resolveUniquePath(cwd: string, targetDir: string, sourceName: string, isDirectory: boolean): Promise<string> {
    const targetBase = this.resolveWritePath(targetDir, cwd)
    await this.assertCanonicalPathInWorktree(cwd, targetBase)
    const candidate = (name: string) => join(targetBase, name)
    const initialCandidate = candidate(sourceName)
    await this.assertCanonicalPathInWorktree(cwd, initialCandidate)
    if (!(await this.pathExists(initialCandidate))) return initialCandidate
    const { stem, ext } = splitCopyName(sourceName, isDirectory)
    let n = 1
    for (;;) {
      const full = candidate(buildCopyName(stem, ext, n))
      await this.assertCanonicalPathInWorktree(cwd, full)
      if (!(await this.pathExists(full))) return full
      n++
    }
  }

  /** 返回相对 cwd 的 `/` 分隔路径，供前端 setSelectedPath 使用 */
  private toRelPath(cwd: string, absPath: string): string {
    return relative(cwd, absPath).replace(/\\/g, '/')
  }

  async copyPath(cwd: string, source: string, targetDir: string): Promise<string> {
    const fullSource = this.resolveWritePath(source, cwd)
    const fullTargetDir = this.resolveWritePath(targetDir, cwd)
    await this.assertCanonicalPathInWorktree(cwd, fullSource)
    await this.assertCanonicalPathInWorktree(cwd, fullTargetDir)
    if (!(await this.pathExists(fullSource))) throw new Error(`文件或文件夹不存在：${source}`)
    if (await this.isDescendantOrSelf(fullSource, fullTargetDir)) throw new Error('不能复制到自身或其子目录中')
    const isDirectory = (await stat(fullSource)).isDirectory()
    const destFull = await this.resolveUniquePath(cwd, targetDir, basename(fullSource), isDirectory)
    await cp(fullSource, destFull, { recursive: isDirectory })
    return this.toRelPath(cwd, destFull)
  }

  async movePath(cwd: string, source: string, targetDir: string): Promise<string> {
    const fullSource = this.resolveWritePath(source, cwd)
    const fullTargetDir = this.resolveWritePath(targetDir, cwd)
    await this.assertCanonicalPathInWorktree(cwd, fullSource)
    await this.assertCanonicalPathInWorktree(cwd, fullTargetDir)
    if (!(await this.pathExists(fullSource))) throw new Error(`文件或文件夹不存在：${source}`)
    if (resolve(fullSource) === resolve(cwd)) throw new Error('不能移动根目录')
    if (await this.isDescendantOrSelf(fullSource, fullTargetDir)) throw new Error('不能移动到自身或其子目录中')
    const sourceName = basename(fullSource)
    // 同文件夹粘贴 → no-op（必须在 resolveUniquePath 之前判断，否则同名目标会被误改名为 copy 后缀）
    if (resolve(join(fullTargetDir, sourceName)) === resolve(fullSource)) return this.toRelPath(cwd, fullSource)
    const isDirectory = (await stat(fullSource)).isDirectory()
    const destFull = await this.resolveUniquePath(cwd, targetDir, sourceName, isDirectory)
    await rename(fullSource, destFull)
    return this.toRelPath(cwd, destFull)
  }

  getWorktreePath(sessionId: string): string {
    const repoSlug = basename(this.repoRoot)
    return join(this.worktreeBaseDir, repoSlug, sessionId)
  }
}
