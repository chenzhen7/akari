import { execa } from 'execa'

export async function getGitRoot(cwd: string): Promise<string | null> {
  try {
    const result = await execa('git', ['-c', 'core.quotepath=false', 'rev-parse', '--show-toplevel'], { cwd })
    return result.stdout.trim().replace(/\\/g, '/')
  } catch {
    return null
  }
}
