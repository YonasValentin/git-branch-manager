import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

export interface TempRepo {
  path: string;
  cleanup: () => void;
  git: (args: string[]) => string;
}

export interface CreateRepoOptions {
  branches?: string[];
  commits?: number;
  defaultBranch?: string;
  withRemote?: boolean;
}

const TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

export function createTempRepo(opts: CreateRepoOptions = {}): TempRepo {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbm-test-'));
  const defaultBranch = opts.defaultBranch ?? 'main';

  const git = (args: string[], cwd: string = tmpDir): string => {
    return execFileSync('git', args, { cwd, env: TEST_ENV, encoding: 'utf-8' }).trim();
  };

  git(['init', '-b', defaultBranch]);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);

  const initialCommits = opts.commits ?? 1;
  for (let i = 0; i < initialCommits; i++) {
    fs.writeFileSync(path.join(tmpDir, `file${i}.txt`), `content ${i}`);
    git(['add', '.']);
    git(['commit', '-m', `commit ${i}`]);
  }

  for (const branch of opts.branches ?? []) {
    git(['checkout', '-b', branch]);
    fs.writeFileSync(path.join(tmpDir, `${branch.replace(/[/\\]/g, '_')}.txt`), `feature ${branch}`);
    git(['add', '.']);
    git(['commit', '-m', `work on ${branch}`]);
    git(['checkout', defaultBranch]);
  }

  return {
    path: tmpDir,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
    git,
  };
}

export function makeStaleCommit(repo: TempRepo, daysAgo: number): void {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  const isoDate = date.toISOString();
  fs.appendFileSync(path.join(repo.path, 'file0.txt'), '\nstale');
  execFileSync('git', ['add', '.'], { cwd: repo.path, env: TEST_ENV });
  execFileSync('git', ['commit', '-m', `stale ${daysAgo}d`], {
    cwd: repo.path,
    env: { ...TEST_ENV, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
  });
}

export function fakeUpstreamGone(repo: TempRepo, branchName: string): void {
  const refPath = path.join(repo.path, '.git', 'refs', 'remotes', 'origin', branchName);
  fs.mkdirSync(path.dirname(refPath), { recursive: true });
  const headHash = repo.git(['rev-parse', branchName]);
  fs.writeFileSync(refPath, `${headHash}\n`);
  repo.git(['branch', `--set-upstream-to=origin/${branchName}`, branchName]);
  fs.unlinkSync(refPath);
}
