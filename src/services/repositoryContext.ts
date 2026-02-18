import * as vscode from 'vscode';
import * as path from 'path';
import { getGitRoot } from '../git/core';
import { GitRepository } from '../types';

/**
 * Manages repository discovery, selection, and active repository state
 * for multi-root workspaces.
 */
export class RepositoryContextManager {
  /** Map from canonical git root path to repository info */
  private repositories: Map<string, GitRepository> = new Map();
  /** Currently active repository path */
  private activeRepo: string | undefined;
  /** Disposable for workspace folder change listener */
  private readonly disposable: vscode.Disposable;

  /**
   * Creates a new RepositoryContextManager.
   * @param context - Extension context for persistence
   */
  constructor(private readonly context: vscode.ExtensionContext) {
    // Restore persisted active repo
    this.activeRepo = context.workspaceState.get<string>('activeRepository');

    // Listen for workspace folder changes and re-discover
    this.disposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void this.discoverRepositories();
    });
  }

  /**
   * Discovers all git repositories across all workspace folders.
   * Handles monorepos by searching for nested .git directories.
   * @returns Array of discovered repositories
   */
  async discoverRepositories(): Promise<GitRepository[]> {
    this.repositories.clear();

    const folders = vscode.workspace.workspaceFolders ?? [];

    for (const folder of folders) {
      // Primary: check workspace folder root directly via git rev-parse
      try {
        const repoPath = await getGitRoot(folder.uri.fsPath);
        if (repoPath && !this.repositories.has(repoPath)) {
          this.repositories.set(repoPath, {
            path: repoPath,
            workspaceFolder: folder,
            name: path.basename(repoPath),
          });
        }
      } catch {
        // Not a git repo at root, try nested scan
      }

      // Secondary: scan for nested .git dirs (monorepo support)
      try {
        const pattern = new vscode.RelativePattern(folder, '**/.git');
        const gitDirs = await vscode.workspace.findFiles(
          pattern,
          '**/node_modules/**',
          50
        );

        for (const gitDir of gitDirs) {
          try {
            const containingDir = path.dirname(gitDir.fsPath);
            const repoPath = await getGitRoot(containingDir);
            if (repoPath && !this.repositories.has(repoPath)) {
              this.repositories.set(repoPath, {
                path: repoPath,
                workspaceFolder: folder,
                name: path.basename(repoPath),
              });
            }
          } catch {
            // Skip individual discovery failures gracefully
          }
        }
      } catch {
        // Skip folder if nested discovery fails
      }
    }

    return Array.from(this.repositories.values());
  }

  /**
   * Prompts the user to select a repository via QuickPick.
   * Returns undefined if none available or user cancels.
   * @returns Selected repository path or undefined
   */
  async selectRepository(): Promise<string | undefined> {
    const repos = Array.from(this.repositories.values());

    if (repos.length === 0) {
      vscode.window.showErrorMessage('No git repositories found in workspace.');
      return undefined;
    }

    if (repos.length === 1) {
      return repos[0].path;
    }

    const items: (vscode.QuickPickItem & { repoPath: string })[] = repos.map(repo => ({
      label: `$(repo) ${repo.name}`,
      description: repo.workspaceFolder.name,
      detail: repo.path,
      repoPath: repo.path,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select repository to manage',
    });

    return selected?.repoPath;
  }

  /**
   * Gets the active repository, discovering and prompting if necessary.
   * Persists the choice to workspaceState for future sessions.
   * @returns Active repository or undefined if none selected
   */
  async getActiveRepository(): Promise<GitRepository | undefined> {
    if (this.repositories.size === 0) {
      await this.discoverRepositories();
    }

    const repos = Array.from(this.repositories.values());

    if (repos.length === 0) {
      return undefined;
    }

    if (repos.length === 1) {
      return repos[0];
    }

    // Check if persisted active repo is still valid
    if (this.activeRepo && this.repositories.has(this.activeRepo)) {
      return this.repositories.get(this.activeRepo);
    }

    // Prompt user to select
    const selectedPath = await this.selectRepository();
    if (selectedPath) {
      await this.setActiveRepository(selectedPath);
      return this.repositories.get(selectedPath);
    }

    return undefined;
  }

  /**
   * Sets the active repository and persists the choice.
   * @param repoPath - Canonical git root path to set as active
   */
  async setActiveRepository(repoPath: string): Promise<void> {
    this.activeRepo = repoPath;
    await this.context.workspaceState.update('activeRepository', repoPath);
  }

  /**
   * Returns all discovered repositories.
   * @returns Array of GitRepository objects
   */
  getRepositories(): GitRepository[] {
    return Array.from(this.repositories.values());
  }

  /**
   * Disposes the workspace folder change listener.
   */
  dispose(): void {
    this.disposable.dispose();
  }
}
