import { gitCommand } from './core';

/**
 * Supported git hosting platforms.
 */
export type Platform = 'github' | 'gitlab' | 'azure' | null;

/**
 * Platform-specific information parsed from the remote URL.
 */
export interface PlatformInfo {
  platform: Platform;
  /** GitHub / GitLab owner or Azure organization */
  owner?: string;
  /** GitHub / GitLab repo name */
  repo?: string;
  /** GitLab project path (e.g. "namespace/project") */
  projectPath?: string;
  /** GitLab host for self-hosted instances (e.g. "gitlab.example.com") */
  gitlabHost?: string;
  /** Azure DevOps organization */
  organization?: string;
  /** Azure DevOps project */
  project?: string;
  /** Azure DevOps repository name */
  azureRepo?: string;
}

/**
 * Detects the git hosting platform from the origin remote URL.
 *
 * Matches patterns in priority order:
 * 1. GitHub (SSH and HTTPS)
 * 2. Azure DevOps new-style HTTPS (dev.azure.com)
 * 3. Azure DevOps old-style HTTPS (*.visualstudio.com)
 * 4. Azure DevOps SSH (ssh.dev.azure.com)
 * 5. GitLab SSH (git@host:ns/repo)
 * 6. GitLab HTTPS fallback (any non-GitHub/Azure host)
 *
 * @param cwd - Working directory of the repository
 * @returns PlatformInfo with detected platform and parsed URL components
 */
export async function detectPlatform(cwd: string): Promise<PlatformInfo> {
  try {
    const url = await gitCommand(['remote', 'get-url', 'origin'], cwd);

    // 1. GitHub — SSH (git@github.com:owner/repo) or HTTPS (https://github.com/owner/repo)
    const githubMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (githubMatch) {
      return {
        platform: 'github',
        owner: githubMatch[1],
        repo: githubMatch[2].replace(/\.git$/, ''),
      };
    }

    // 2. Azure DevOps new HTTPS — https://dev.azure.com/org/project/_git/repo
    const azureNewMatch = url.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/.]+)/);
    if (azureNewMatch) {
      return {
        platform: 'azure',
        organization: azureNewMatch[1],
        project: azureNewMatch[2],
        azureRepo: azureNewMatch[3].replace(/\.git$/, ''),
      };
    }

    // 3. Azure DevOps old HTTPS — https://org.visualstudio.com/project/_git/repo
    const azureOldMatch = url.match(/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/.]+)/);
    if (azureOldMatch) {
      return {
        platform: 'azure',
        organization: azureOldMatch[1],
        project: azureOldMatch[2],
        azureRepo: azureOldMatch[3].replace(/\.git$/, ''),
      };
    }

    // 4. Azure DevOps SSH — git@ssh.dev.azure.com:v3/org/project/repo
    const azureSshMatch = url.match(/ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/.]+)/);
    if (azureSshMatch) {
      return {
        platform: 'azure',
        organization: azureSshMatch[1],
        project: azureSshMatch[2],
        azureRepo: azureSshMatch[3].replace(/\.git$/, ''),
      };
    }

    // 5. GitLab SSH — git@gitlab.com:namespace/repo (or self-hosted)
    const gitlabSshMatch = url.match(/git@([^:]+):([^/]+)\/([^/.]+)/);
    if (gitlabSshMatch) {
      const gitlabHost = gitlabSshMatch[1];
      const ns = gitlabSshMatch[2];
      const proj = gitlabSshMatch[3].replace(/\.git$/, '');
      return {
        platform: 'gitlab',
        gitlabHost,
        projectPath: `${ns}/${proj}`,
      };
    }

    // 6. GitLab HTTPS fallback — https://gitlab.com/namespace/repo (or self-hosted)
    //    Excludes github.com and Azure hosts already matched above.
    const gitlabHttpsMatch = url.match(/https?:\/\/([^/]+)\/([^/]+)\/([^/.]+)/);
    if (gitlabHttpsMatch) {
      const gitlabHost = gitlabHttpsMatch[1];
      // Skip hosts already handled by GitHub/Azure matchers
      if (!gitlabHost.includes('github.com') && !gitlabHost.includes('dev.azure.com') && !gitlabHost.includes('visualstudio.com')) {
        const ns = gitlabHttpsMatch[2];
        const proj = gitlabHttpsMatch[3].replace(/\.git$/, '');
        return {
          platform: 'gitlab',
          gitlabHost,
          projectPath: `${ns}/${proj}`,
        };
      }
    }
  } catch {}

  return { platform: null };
}
