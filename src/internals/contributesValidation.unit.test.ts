import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');

interface PackageJson {
  contributes?: {
    commands?: Array<{ command: string; title: string; category?: string }>;
    menus?: Record<string, Array<{ command: string }>>;
    keybindings?: Array<{ command: string }>;
  };
}

function readPackageJson(): PackageJson {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
}

function readExtensionSrc(): string {
  return fs.readFileSync(path.join(repoRoot, 'src/extension.ts'), 'utf-8');
}

function extractRegisteredCommands(src: string): Set<string> {
  const matches = src.matchAll(/registerCommand\(\s*['"]([^'"]+)['"]/g);
  return new Set(Array.from(matches, (m) => m[1] as string));
}

describe('package.json ↔ extension.ts command parity', () => {
  test('every command in contributes.commands is registered', () => {
    const pkg = readPackageJson();
    const src = readExtensionSrc();
    const registered = extractRegisteredCommands(src);
    const declared = pkg.contributes?.commands?.map((c) => c.command) ?? [];

    const missing = declared.filter((cmd) => !registered.has(cmd));
    expect(missing).toEqual([]);
  });

  test('every command referenced in menus is declared in commands', () => {
    const pkg = readPackageJson();
    const declared = new Set((pkg.contributes?.commands ?? []).map((c) => c.command));
    const allMenuCommands = new Set<string>();
    for (const items of Object.values(pkg.contributes?.menus ?? {})) {
      for (const item of items) {
        allMenuCommands.add(item.command);
      }
    }

    const orphaned = Array.from(allMenuCommands).filter((cmd) => !declared.has(cmd));
    expect(orphaned).toEqual([]);
  });

  test('every command referenced in keybindings is declared in commands', () => {
    const pkg = readPackageJson();
    const declared = new Set((pkg.contributes?.commands ?? []).map((c) => c.command));
    const keybindingCmds = (pkg.contributes?.keybindings ?? []).map((k) => k.command);
    const orphaned = keybindingCmds.filter((cmd) => !declared.has(cmd));
    expect(orphaned).toEqual([]);
  });

  test('every declared command has the Git Branch Manager category', () => {
    const pkg = readPackageJson();
    const cmds = pkg.contributes?.commands ?? [];
    const missingCategory = cmds.filter((c) => c.category !== 'Git Branch Manager');
    expect(missingCategory.map((c) => c.command)).toEqual([]);
  });
});
