import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileSystemService } from '../infrastructure/fs/file-system.service.js'

describe('FileSystemService path boundaries', () => {
  let testRoot: string
  let repoRoot: string
  let workspacePath: string
  let worktreeBaseDir: string
  let outsidePath: string
  let service: FileSystemService

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'akari-fs-security-'))
    repoRoot = join(testRoot, 'repo')
    workspacePath = join(repoRoot, 'workspace')
    worktreeBaseDir = join(repoRoot, '.agent-worktrees')
    outsidePath = join(testRoot, 'outside.txt')
    await mkdir(workspacePath, { recursive: true })
    await mkdir(worktreeBaseDir, { recursive: true })
    await writeFile(outsidePath, 'outside', 'utf8')
    service = new FileSystemService(repoRoot, workspacePath, worktreeBaseDir)
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it('reads and writes ordinary workspace files', async () => {
    await service.writeFileContent(workspacePath, 'nested/example.txt', 'hello')
    await expect(service.readFileContent(workspacePath, 'nested/example.txt')).resolves.toBe('hello')
  })

  it('rejects traversal reads and directory listings', async () => {
    await expect(service.readFileContent(workspacePath, '../../outside.txt')).rejects.toThrow('invalid file path')
    await expect(service.listFiles(workspacePath, '../..')).rejects.toThrow('invalid file path')
  })

  it('rejects traversal writes without changing the outside file', async () => {
    await expect(service.writeFileContent(workspacePath, '../../outside.txt', 'changed')).rejects.toThrow('invalid file path')
    await expect(readFile(outsidePath, 'utf8')).resolves.toBe('outside')
  })

  it('rejects symlink traversal for reads and writes', async () => {
    const outsideDir = join(testRoot, 'outside-dir')
    await mkdir(outsideDir)
    await writeFile(join(outsideDir, 'secret.txt'), 'secret', 'utf8')
    await symlink(outsideDir, join(workspacePath, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(service.readFileContent(workspacePath, 'escape/secret.txt')).rejects.toThrow('invalid file path')
    await expect(service.writeFileContent(workspacePath, 'escape/new.txt', 'changed')).rejects.toThrow('invalid file path')
  })

  it('rejects upload names containing path separators', async () => {
    await expect(service.writeBinaryFile(workspacePath, '', '../outside.bin', Buffer.from('data')))
      .rejects.toThrow('invalid file name')
  })
})
