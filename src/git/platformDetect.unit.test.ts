import { describe, expect, test, vi, beforeEach } from 'vitest';

const gitMock = vi.fn();
vi.mock('./core', () => ({
  gitCommand: (...args: unknown[]) => gitMock(...args),
}));

import { detectPlatform } from './platformDetect';

beforeEach(() => {
  gitMock.mockReset();
});

describe('detectPlatform — GitHub', () => {
  test('parses HTTPS URL', async () => {
    gitMock.mockResolvedValue('https://github.com/owner/repo.git');
    const info = await detectPlatform('/x');
    expect(info.platform).toBe('github');
    expect(info.owner).toBe('owner');
    expect(info.repo).toBe('repo');
  });

  test('parses SSH URL', async () => {
    gitMock.mockResolvedValue('git@github.com:owner/repo.git');
    const info = await detectPlatform('/x');
    expect(info.platform).toBe('github');
    expect(info.owner).toBe('owner');
    expect(info.repo).toBe('repo');
  });

  test('strips .git suffix', async () => {
    gitMock.mockResolvedValue('https://github.com/o/r.git');
    expect((await detectPlatform('/x')).repo).toBe('r');
  });

  test('handles URL without .git suffix', async () => {
    gitMock.mockResolvedValue('https://github.com/o/r');
    expect((await detectPlatform('/x')).repo).toBe('r');
  });
});

describe('detectPlatform — Azure DevOps', () => {
  test('parses dev.azure.com new-style HTTPS', async () => {
    gitMock.mockResolvedValue('https://dev.azure.com/myorg/myproj/_git/myrepo');
    const info = await detectPlatform('/x');
    expect(info.platform).toBe('azure');
    expect(info.organization).toBe('myorg');
    expect(info.project).toBe('myproj');
    expect(info.azureRepo).toBe('myrepo');
  });

  test('parses *.visualstudio.com legacy HTTPS', async () => {
    gitMock.mockResolvedValue('https://myorg.visualstudio.com/myproj/_git/myrepo');
    const info = await detectPlatform('/x');
    expect(info.platform).toBe('azure');
    expect(info.organization).toBe('myorg');
    expect(info.project).toBe('myproj');
    expect(info.azureRepo).toBe('myrepo');
  });

  test('parses ssh.dev.azure.com:v3 SSH URL', async () => {
    gitMock.mockResolvedValue('git@ssh.dev.azure.com:v3/myorg/myproj/myrepo');
    const info = await detectPlatform('/x');
    expect(info.platform).toBe('azure');
    expect(info.organization).toBe('myorg');
    expect(info.project).toBe('myproj');
    expect(info.azureRepo).toBe('myrepo');
  });
});

describe('detectPlatform — GitLab', () => {
  test('parses gitlab.com SSH', async () => {
    gitMock.mockResolvedValue('git@gitlab.com:group/project.git');
    const info = await detectPlatform('/x');
    expect(info.platform).toBe('gitlab');
    expect(info.gitlabHost).toBe('gitlab.com');
    expect(info.projectPath).toBe('group/project');
  });

  test('parses self-hosted GitLab SSH', async () => {
    gitMock.mockResolvedValue('git@gitlab.example.com:group/project.git');
    const info = await detectPlatform('/x');
    expect(info.platform).toBe('gitlab');
    expect(info.gitlabHost).toBe('gitlab.example.com');
  });

  test('parses gitlab.com HTTPS as fallback', async () => {
    gitMock.mockResolvedValue('https://gitlab.com/group/project.git');
    const info = await detectPlatform('/x');
    expect(info.platform).toBe('gitlab');
    expect(info.gitlabHost).toBe('gitlab.com');
    expect(info.projectPath).toBe('group/project');
  });

  test('does not match HTTPS for github.com (would be matched as github)', async () => {
    gitMock.mockResolvedValue('https://github.com/o/r.git');
    expect((await detectPlatform('/x')).platform).toBe('github');
  });

  test('does not match HTTPS for dev.azure.com (would be matched as azure)', async () => {
    gitMock.mockResolvedValue('https://dev.azure.com/o/p/_git/r');
    expect((await detectPlatform('/x')).platform).toBe('azure');
  });
});

describe('detectPlatform — null fallback', () => {
  test('returns platform=null when gitCommand throws', async () => {
    gitMock.mockRejectedValue(new Error('not a git repo'));
    expect((await detectPlatform('/x')).platform).toBe(null);
  });

  test('returns platform=null for unrecognized URL', async () => {
    gitMock.mockResolvedValue('file:///local/path/repo');
    expect((await detectPlatform('/x')).platform).toBe(null);
  });
});
