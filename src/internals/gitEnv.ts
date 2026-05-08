// Builds a sanitized environment for `execFile('git', ...)` calls.
//
// Two production hazards we mitigate:
//   1. GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_CONFIG inherited from
//      the parent VS Code process (or shell that launched it) can override
//      the explicit `cwd: gitRoot` and operate on the wrong repo.
//   2. Without GIT_TERMINAL_PROMPT=0, a misconfigured remote (HTTPS without
//      stored credentials) makes `git fetch`/`push`/`ls-remote` block
//      indefinitely on a credential prompt that has no terminal to read
//      from. The extension hangs.

const STRIP_PREFIXES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG'];

export function buildGitEnv(parentEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (STRIP_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix + '_'))) {
      continue;
    }
    env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}
