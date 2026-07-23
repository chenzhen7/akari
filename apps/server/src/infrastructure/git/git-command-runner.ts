import { execa } from 'execa'
import { resolve } from 'node:path'

export type GitErrorCode =
  | 'NOT_A_GIT_REPO'
  | 'NOTHING_TO_COMMIT'
  | 'MERGE_CONFLICT'
  | 'NETWORK_ERROR'
  | 'AUTHENTICATION_FAILED'
  | 'LOCKED'
  | 'UNKNOWN'

export class GitError extends Error {
  constructor(
    message: string,
    public readonly code: GitErrorCode,
    public readonly args: string[],
    public readonly cwd: string,
  ) {
    super(message)
    this.name = 'GitError'
  }
}

export interface GitRunOptions {
  timeout?: number
}

/**
 * Centralized Git command executor.
 *
 * Responsibilities:
 * - Serialize git commands per repository root to avoid IO spikes.
 * - Disable pager and enforce consistent quoting.
 * - Add --no-ext-diff and --no-renames to diff commands.
 * - Apply a default timeout so git commands cannot hang forever.
 * - Classify common git errors so callers can react specifically.
 */
export class GitCommandRunner {
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly defaultTimeout = 30000

  async run(args: string[], cwd: string, options: GitRunOptions = {}): Promise<string> {
    const key = resolve(cwd)
    const previous = this.locks.get(key) ?? Promise.resolve()
    const task = previous.then(() => this.exec(args, cwd, options))
    this.locks.set(key, task.catch(() => {}))
    return task
  }

  private async exec(args: string[], cwd: string, options: GitRunOptions): Promise<string> {
    const normalizedArgs = this.normalizeArgs(args)
    try {
      const result = await execa('git', normalizedArgs, {
        cwd,
        timeout: options.timeout ?? this.defaultTimeout,
      })
      return result.stdout
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const firstLine = message.split(/\r?\n/)[0] ?? message
      console.error(`[git] command failed: git ${args.join(' ')} in ${cwd}: ${firstLine}`)
      throw this.classifyError(firstLine, args, cwd, err)
    }
  }

  private normalizeArgs(args: string[]): string[] {
    const result = ['--no-pager', '-c', 'core.quotepath=false', ...args]

    // Insert diff-specific flags immediately after the 'diff' subcommand.
    if (args[0] === 'diff') {
      result.splice(4, 0, '--no-ext-diff', '--no-renames')
    }

    return result
  }

  private classifyError(message: string, args: string[], cwd: string, original: unknown): GitError {
    const lower = message.toLowerCase()
    if (lower.includes('not a git repository')) {
      return new GitError(message, 'NOT_A_GIT_REPO', args, cwd)
    }
    if (lower.includes('nothing to commit')) {
      return new GitError(message, 'NOTHING_TO_COMMIT', args, cwd)
    }
    if (lower.includes('merge conflict') || lower.includes('conflict')) {
      return new GitError(message, 'MERGE_CONFLICT', args, cwd)
    }
    if (lower.includes('could not resolve host') || lower.includes('failed to connect')) {
      return new GitError(message, 'NETWORK_ERROR', args, cwd)
    }
    if (lower.includes('authentication failed') || lower.includes('could not read username')) {
      return new GitError(message, 'AUTHENTICATION_FAILED', args, cwd)
    }
    if (lower.includes('unable to create') && lower.includes('lock file')) {
      return new GitError(message, 'LOCKED', args, cwd)
    }
    return new GitError(message, 'UNKNOWN', args, cwd)
  }
}
