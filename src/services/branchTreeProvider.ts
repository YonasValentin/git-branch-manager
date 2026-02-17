import * as vscode from 'vscode';
import { BranchInfo } from '../types';
import { getBranchInfo } from '../git';
import { RepositoryContextManager } from './repositoryContext';

/**
 * Union type for all tree node variants.
 */
export type BranchTreeNode = StatusGroupItem | BranchItem | LoadMoreItem;

/**
 * Root-level tree item representing a status group (Merged, Stale, Orphaned, Active).
 * Shows branch count in label and collapses when non-empty.
 */
export class StatusGroupItem extends vscode.TreeItem {
  public readonly groupName: 'Merged' | 'Stale' | 'Orphaned' | 'Active';
  public readonly branches: BranchInfo[];
  public readonly repoPath: string;

  constructor(
    groupName: 'Merged' | 'Stale' | 'Orphaned' | 'Active',
    branches: BranchInfo[],
    repoPath: string
  ) {
    super(
      `${groupName} (${branches.length})`,
      branches.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.groupName = groupName;
    this.branches = branches;
    this.repoPath = repoPath;
    this.contextValue = 'branchGroup';
    this.id = `${repoPath}:${groupName}`;

    const iconMap: Record<typeof groupName, string> = {
      Merged: 'git-merge',
      Stale: 'watch',
      Orphaned: 'warning',
      Active: 'check',
    };
    this.iconPath = new vscode.ThemeIcon(iconMap[groupName]);
  }
}

/**
 * Leaf tree item representing an individual branch.
 * Shows health score in description and PR status via ThemeIcon.
 */
export class BranchItem extends vscode.TreeItem {
  public readonly branch: BranchInfo;
  public readonly repoPath: string;
  /** Parent group — needed for reveal() support */
  public parentGroup: StatusGroupItem | undefined;

  constructor(branch: BranchInfo, repoPath: string) {
    super(branch.name, vscode.TreeItemCollapsibleState.None);

    this.branch = branch;
    this.repoPath = repoPath;
    this.description = `${branch.healthScore ?? 100}`;
    this.contextValue = branch.isCurrentBranch ? 'currentBranch' : 'branch';
    this.id = `${repoPath}:${branch.name}`;

    // PR status icon
    const prState = branch.prStatus?.state;
    let iconId: string;
    if (prState === 'open') {
      iconId = 'git-pull-request';
    } else if (prState === 'draft') {
      iconId = 'git-pull-request-go-to-changes';
    } else if (prState === 'merged') {
      iconId = 'git-merge';
    } else if (prState === 'closed') {
      iconId = 'git-pull-request-closed';
    } else {
      iconId = 'git-branch';
    }
    this.iconPath = new vscode.ThemeIcon(iconId);

    // Tooltip with detailed info
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`### ${branch.name}\n`);
    md.appendMarkdown(`- **Health Score:** ${branch.healthScore ?? 100}\n`);
    if (branch.healthReason) {
      md.appendMarkdown(`- **Reason:** ${branch.healthReason}\n`);
    }
    md.appendMarkdown(`- **Days Old:** ${branch.daysOld}\n`);
    md.appendMarkdown(`- **Merged:** ${branch.isMerged ? 'Yes' : 'No'}\n`);
    this.tooltip = md;
  }
}

/**
 * Sentinel leaf node shown when a group has more than 200 branches.
 * Clicking it fires the loadMoreBranches command.
 */
export class LoadMoreItem extends vscode.TreeItem {
  constructor(group: StatusGroupItem, remaining: number) {
    super(`Load ${Math.min(remaining, 200)} more...`, vscode.TreeItemCollapsibleState.None);

    this.command = {
      command: 'git-branch-manager.loadMoreBranches',
      title: 'Load More',
      arguments: [group],
    };
    this.iconPath = new vscode.ThemeIcon('fold-down');
    this.contextValue = 'loadMore';
  }
}

/** Page size used when slicing branch lists for display. */
const PAGE_SIZE = 200;

/**
 * TreeDataProvider powering the Branch Manager sidebar tree view.
 * Groups branches by status (Merged, Stale, Orphaned, Active) and
 * supports pagination for large repositories.
 */
export class BranchTreeProvider
  implements vscode.TreeDataProvider<BranchTreeNode>
{
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<BranchTreeNode | undefined | null | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Tracks current page size per group key (`${repoPath}:${groupName}`). */
  private groupPageSizes: Map<string, number> = new Map();

  /** Pending debounce handle. */
  private refreshTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly repoContext: RepositoryContextManager) {}

  /**
   * Debounced refresh — coalesces rapid change events into a single update.
   */
  scheduleRefresh(): void {
    if (this.refreshTimeout !== undefined) {
      clearTimeout(this.refreshTimeout);
    }
    this.refreshTimeout = setTimeout(() => {
      this.refreshTimeout = undefined;
      this._onDidChangeTreeData.fire();
    }, 100);
  }

  /** Returns the element itself (all node types extend TreeItem). */
  getTreeItem(element: BranchTreeNode): vscode.TreeItem {
    return element;
  }

  /**
   * Returns child nodes for the given element, or root nodes when called
   * with no argument.
   */
  async getChildren(element?: BranchTreeNode): Promise<BranchTreeNode[]> {
    if (!element) {
      return this.getRootNodes();
    }
    if (element instanceof StatusGroupItem) {
      return this.getBranchItems(element);
    }
    return [];
  }

  /**
   * Returns the parent of a tree node — enables `TreeView.reveal()`.
   */
  getParent(element: BranchTreeNode): BranchTreeNode | undefined {
    if (element instanceof BranchItem) {
      return element.parentGroup;
    }
    // StatusGroupItem and LoadMoreItem are root or unresolvable
    return undefined;
  }

  /**
   * Produces the four root StatusGroupItems from the active repository.
   */
  private async getRootNodes(): Promise<StatusGroupItem[]> {
    const repos = this.repoContext.getRepositories();
    if (repos.length === 0) {
      return [];
    }

    // Single active repo model (Phase 8 design)
    const repo = repos[0];
    const daysUntilStale: number = vscode.workspace
      .getConfiguration('gitBranchManager')
      .get('daysUntilStale', 30);

    let branches: BranchInfo[];
    try {
      branches = await getBranchInfo(repo.path);
    } catch {
      return [];
    }

    const merged: BranchInfo[] = [];
    const stale: BranchInfo[] = [];
    const orphaned: BranchInfo[] = [];
    const active: BranchInfo[] = [];

    for (const branch of branches) {
      if (branch.isCurrentBranch) {
        active.push(branch);
        continue;
      }
      if (branch.isMerged) {
        merged.push(branch);
      } else if (branch.remoteGone) {
        orphaned.push(branch);
      } else if (branch.daysOld > daysUntilStale) {
        stale.push(branch);
      } else {
        active.push(branch);
      }
    }

    return [
      new StatusGroupItem('Merged', merged, repo.path),
      new StatusGroupItem('Stale', stale, repo.path),
      new StatusGroupItem('Orphaned', orphaned, repo.path),
      new StatusGroupItem('Active', active, repo.path),
    ];
  }

  /**
   * Returns BranchItem children for a group, sliced to the current page
   * size. Appends a LoadMoreItem sentinel when additional branches remain.
   */
  private getBranchItems(group: StatusGroupItem): BranchTreeNode[] {
    const key = `${group.repoPath}:${group.groupName}`;
    const pageSize = this.groupPageSizes.get(key) ?? PAGE_SIZE;
    const visible = group.branches.slice(0, pageSize);
    const remaining = group.branches.length - visible.length;

    const items: BranchTreeNode[] = visible.map(branch => {
      const item = new BranchItem(branch, group.repoPath);
      item.parentGroup = group;
      return item;
    });

    if (remaining > 0) {
      items.push(new LoadMoreItem(group, remaining));
    }

    return items;
  }

  /**
   * Increases the page size for the given group by 200 and refreshes.
   */
  loadMore(group: StatusGroupItem): void {
    const key = `${group.repoPath}:${group.groupName}`;
    const current = this.groupPageSizes.get(key) ?? PAGE_SIZE;
    this.groupPageSizes.set(key, current + PAGE_SIZE);
    this._onDidChangeTreeData.fire();
  }

  /** Cleans up pending timeout. */
  dispose(): void {
    if (this.refreshTimeout !== undefined) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = undefined;
    }
    this._onDidChangeTreeData.dispose();
  }
}
