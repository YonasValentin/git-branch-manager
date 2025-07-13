# Git Branch Manager

[![Version](https://img.shields.io/visual-studio-marketplace/v/YonasValentinMougaardKristensen.git-branch-manager-pro)](https://marketplace.visualstudio.com/items?itemName=YonasValentinMougaardKristensen.git-branch-manager-pro)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/YonasValentinMougaardKristensen.git-branch-manager-pro)](https://marketplace.visualstudio.com/items?itemName=YonasValentinMougaardKristensen.git-branch-manager-pro)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/YonasValentinMougaardKristensen.git-branch-manager-pro)](https://marketplace.visualstudio.com/items?itemName=YonasValentinMougaardKristensen.git-branch-manager-pro)
[![Sponsor](https://img.shields.io/github/sponsors/YonasValentin?label=Sponsor&logo=github)](https://github.com/sponsors/YonasValentin)

**Stop manually deleting old branches.** This extension shows you which branches are merged or stale, and lets you clean them up with one click.

## The Problem

You know that feeling when you run `git branch` and see 47 branches from features you shipped months ago? This fixes that.

## What It Does

- Shows all your branches in a dashboard, organized by status (merged, old, active)
- Identifies merged branches that are safe to delete
- Flags old branches (30+ days since last commit, configurable)
- One-click cleanup or select exactly which ones to delete
- Branch templates for consistent naming (`feature/`, `bugfix/`, `hotfix/`, etc.)
- Status bar indicator showing how many branches need attention

## Quick Start

1. Install the extension
2. Click the branch icon in your status bar, or run `Git Branch Manager: Show Branch Cleaner`
3. See your branches organized by type
4. Delete what you don't need

**Keyboard shortcuts:**
- `Cmd+Shift+G Cmd+Shift+C` (Mac) / `Ctrl+Shift+G Ctrl+Shift+C` (Windows) - Open dashboard
- `Cmd+Shift+G Cmd+Shift+N` (Mac) / `Ctrl+Shift+G Ctrl+Shift+N` (Windows) - Create branch from template

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
| `gitBranchManager.daysUntilStale` | `30` | Days before a branch is flagged as old |
| `gitBranchManager.protectedBranches` | `["main", "master", "develop", "dev", "staging", "production"]` | Branches that will never be suggested for deletion |
| `gitBranchManager.confirmBeforeDelete` | `true` | Show confirmation dialog before deleting |
| `gitBranchManager.showNotifications` | `true` | Show notifications when branches need cleanup |

## FAQ

**Does this delete remote branches?**
No. Only local branches. Your remote is safe.

**Can I undo a deletion?**
Git doesn't make branch deletion easily reversible. That's why the extension shows a confirmation dialog. If you need to recover a deleted branch, you can use `git reflog` to find the commit and recreate it.

**Why doesn't my branch show up?**
Protected branches (main, master, develop, etc.) are hidden from the cleanup list. You can customize this list in settings.

**Is this safe to use?**
Yes. The extension only deletes local branches you explicitly select. It shows confirmations before bulk operations. Protected branches are never suggested for deletion.

## Requirements

- VS Code 1.74.0 or higher
- Git installed and accessible from command line
- An open Git repository

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history. This extension is actively maintained.

## Found a Bug?

[Open an issue on GitHub](https://github.com/yonasvalentin/git-branch-manager-pro/issues) - I read every one.

---

## Support

If this extension saves you time, consider:
- [Leaving a review](https://marketplace.visualstudio.com/items?itemName=YonasValentinMougaardKristensen.git-branch-manager-pro&ssr=false#review-details) - helps others find it
- [Buying me a coffee](https://www.buymeacoffee.com/YonasValentin) - fuels development of new features

[![Buy Me a Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/YonasValentin)

---

MIT License
