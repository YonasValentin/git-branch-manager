import * as vscode from 'vscode';
import { execFile } from '../git/core';

export const GIT_DIFF_SCHEME = 'git-branch-manager-diff';

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const branch = params.get('branch');
    const filePath = params.get('file');
    const repoPath = params.get('repo');

    if (!branch || !filePath || !repoPath) return '';

    try {
      const { stdout } = await execFile(
        'git',
        ['show', `${branch}:${filePath}`],
        { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
      );
      return stdout;
    } catch {
      return `// File "${filePath}" does not exist in branch "${branch}"`;
    }
  }
}
