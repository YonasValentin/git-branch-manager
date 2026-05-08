import * as cp from 'child_process';
import { promisify } from 'util';
import { buildGitEnv } from '../internals/gitEnv';

const execFileAsync = promisify(cp.execFile);

/**
 * Error class that carries through git's own stderr message instead of the
 * opaque "spawn ENOENT" / "Command failed" wrapper Node provides.
 */
export class GitCommandError extends Error {
  constructor(message: string, public readonly stderr: string, public readonly exitCode?: number) {
    super(message);
    this.name = 'GitCommandError';
  }
}

// @throws {GitCommandError} on non-zero exit, carrying git's stderr
export async function gitCommand(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: buildGitEnv(),
    });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: unknown; message?: string; code?: number };
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
    const exitCode = typeof e.code === 'number' ? e.code : undefined;
    // Prefer git's own stderr ("would clobber", "needs merge", etc.) over
    // Node's "Command failed" wrapper.
    const message = stderr || e.message || 'git command failed';
    throw new GitCommandError(message, stderr, exitCode);
  }
}

// Raw execFile — callers must pass env: buildGitEnv() themselves.
export { execFileAsync as execFile };
export { buildGitEnv };

export async function getGitRoot(workspacePath: string): Promise<string | undefined> {
  try {
    return await gitCommand(['rev-parse', '--show-toplevel'], workspacePath);
  } catch {
    return undefined;
  }
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  return await gitCommand(['branch', '--show-current'], cwd);
}

export async function getBaseBranch(cwd: string): Promise<string> {
  try {
    const stdout = await gitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
    return stdout.replace('refs/remotes/origin/', '');
  } catch {
    try {
      const stdout = await gitCommand(['branch', '-r'], cwd);
      if (stdout.includes('origin/main')) return 'main';
      if (stdout.includes('origin/master')) return 'master';
    } catch {}
    try {
      const local = await gitCommand(['branch', '--format=%(refname:short)'], cwd);
      const localBranches = local.split('\n').map(b => b.trim()).filter(Boolean);
      if (localBranches.includes('main')) return 'main';
      if (localBranches.includes('master')) return 'master';
    } catch {}
    return 'main';
  }
}
