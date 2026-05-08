import * as vscode from 'vscode';
import { execFile, buildGitEnv } from '../git/core';
import { isValidGitRef, isValidRepoPath } from '../internals/validateRef';

export const GIT_DIFF_SCHEME = 'git-branch-manager-diff';

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const branch = params.get('branch');
    const filePath = params.get('file');
    const repoPath = params.get('repo');

    if (!branch || !filePath || !repoPath) return '';

    // Reject refs/paths that could break out of `<rev>:<path>` or hang on a credential prompt.
    if (!isValidGitRef(branch) || !isValidRepoPath(repoPath)) {
      return `// Refused to fetch "${filePath}" from "${branch}" — invalid ref or path`;
    }
    if (token.isCancellationRequested) return '';

    try {
      // `--` separator: ensures everything after is treated as a positional
      // arg, not a flag. Even if `branch` somehow gets past validation as
      // `-foo`, git won't interpret it as `--upload-pack=...` etc.
      const child = execFile(
        'git',
        ['show', '--', `${branch}:${filePath}`],
        { cwd: repoPath, maxBuffer: 5 * 1024 * 1024, env: buildGitEnv() }
      );
      // Honor cancellation: if VS Code closes/cancels the diff, kill git.
      const cancelSub = token.onCancellationRequested(() => child.child?.kill());
      try {
        const { stdout } = await child;
        return stdout;
      } finally {
        cancelSub.dispose();
      }
    } catch {
      return `// File "${filePath}" does not exist in branch "${branch}"`;
    }
  }
}
