# Git Branch Manager

[![Version](https://img.shields.io/visual-studio-marketplace/v/YonasValentinMougaardKristensen.git-branch-manager-pro)](https://marketplace.visualstudio.com/items?itemName=YonasValentinMougaardKristensen.git-branch-manager-pro)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/YonasValentinMougaardKristensen.git-branch-manager-pro)](https://marketplace.visualstudio.com/items?itemName=YonasValentinMougaardKristensen.git-branch-manager-pro)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/YonasValentinMougaardKristensen.git-branch-manager-pro)](https://marketplace.visualstudio.com/items?itemName=YonasValentinMougaardKristensen.git-branch-manager-pro)
[![Sponsor](https://img.shields.io/github/sponsors/YonasValentin?label=Sponsor&logo=github)](https://github.com/sponsors/YonasValentin)

**Stop manually deleting old branches.** This extension shows you which branches are merged or stale, and lets you clean them up with one click.

## Features

### Branch Health Scoring
Every branch gets a health score (0-100) based on merge status, age, remote tracking, and commits behind. Instantly see which branches need attention.

### Local Branch Management
- Dashboard showing all branches organized by status (merged, stale, orphaned, active)
- Bulk delete operations with confirmation
- Branch templates for consistent naming

### Remote Branch Management
- View and clean merged remote branches
- Prune stale remote references
- Identify orphaned local branches (remote deleted)

### Git Worktree Integration
- List all worktrees in your repository
- Create new worktrees from any branch
- Open worktrees in new VS Code windows
- Lock/unlock and remove worktrees

### Stash Management
- View all stashes with file count and age
- Create stashes (with or without untracked files)
- Apply, pop, or drop individual stashes
- Clear all stashes with confirmation

## Quick Start

1. Install the extension
2. Click the branch icon in your status bar, or run `Git Branch Manager: Show Branch Cleaner`
3. Use the tabs to navigate: Local, Remote, Worktrees, Stashes
4. Clean up what you don't need

**Keyboard shortcuts:**
- `Cmd+Shift+G Cmd+Shift+C` (Mac) / `Ctrl+Shift+G Ctrl+Shift+C` (Windows) - Open dashboard
- `Cmd+Shift+G Cmd+Shift+N` (Mac) / `Ctrl+Shift+G Ctrl+Shift+N` (Windows) - Create branch from template

## Commands

| Command | Description |
|---------|-------------|
| `Git Branch Manager: Show Branch Cleaner` | Open the main dashboard |
| `Git Branch Manager: Quick Clean Merged Branches` | Delete all merged branches |
| `Git Branch Manager: Create Branch from Template` | Create a new branch using templates |
| `Git Branch Manager: Clean Remote Branches` | Clean merged remote branches |
| `Git Branch Manager: Manage Worktrees` | View and manage worktrees |
| `Git Branch Manager: Create Worktree` | Create a worktree from a branch |
| `Git Branch Manager: Quick Stash` | Stash current changes |
| `Git Branch Manager: Pop Latest Stash` | Pop the most recent stash |

## Branch Templates

Create branches with consistent naming:

| Template | Pattern | Example |
|----------|---------|---------|
| Feature | `feature/{description}` | `feature/add-user-auth` |
| Bugfix | `bugfix/{description}` | `bugfix/fix-login-error` |
| Hotfix | `hotfix/{description}` | `hotfix/critical-payment-fix` |
| Release | `release/{version}` | `release/v1.2.0` |
| Experiment | `exp/{description}` | `exp/new-algorithm` |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `gitBranchManager.daysUntilStale` | `30` | Days before a branch is flagged as stale |
| `gitBranchManager.protectedBranches` | `["main", "master", "develop", "dev", "staging", "production"]` | Branches that will never be suggested for deletion |
| `gitBranchManager.confirmBeforeDelete` | `true` | Show confirmation dialog before deleting |
| `gitBranchManager.showNotifications` | `true` | Show notifications when branches need cleanup |

## FAQ

**Does this delete remote branches?**
Yes, but only through the Remote tab with explicit confirmation. Local deletions don't affect your remote.

**Can I undo a deletion?**
Git doesn't make branch deletion easily reversible. That's why the extension shows confirmation dialogs. If you need to recover a deleted branch, use `git reflog` to find the commit and recreate it.

**Why doesn't my branch show up?**
Protected branches (main, master, develop, etc.) are hidden from the cleanup list. You can customize this in settings.

**What are orphaned branches?**
Local branches whose remote tracking branch has been deleted. These are safe to clean up.

## Requirements

- VS Code 1.74.0 or higher
- Git installed and accessible from command line
- An open Git repository

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Found a Bug?

[Open an issue on GitHub](https://github.com/yonasvalentin/git-branch-manager-pro/issues)

---

## Support

If this extension saves you time, consider:
- [Leaving a review](https://marketplace.visualstudio.com/items?itemName=YonasValentinMougaardKristensen.git-branch-manager-pro&ssr=false#review-details) - helps others find it
- [Buying me a coffee](https://www.buymeacoffee.com/YonasValentin) - fuels development

[![Buy Me a Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/YonasValentin)

---

MIT License
