import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'yonasvalentinmougaardkristensen.git-branch-manager-pro';

// Commands that are safe to invoke without arguments and won't open
// blocking UI dialogs in a test run (their handlers either fail-fast or
// no-op when there's no active git repo / no branches to act on).
// Note: commands that open interactive dialogs (QuickPick / InputBox) are
// excluded — they block waiting for user input that never arrives in tests.
const SAFE_COMMANDS = [
	'git-branch-manager.refreshTree',
	'git-branch-manager.cleanGoneBranches',
	'git-branch-manager.undoDelete',
];

suite('Command invocation smoke tests', () => {
	suiteSetup(async () => {
		const ext = vscode.extensions.getExtension(EXTENSION_ID);
		await ext!.activate();
	});

	for (const cmd of SAFE_COMMANDS) {
		test(`'${cmd}' does not throw when invoked`, async () => {
			try {
				await vscode.commands.executeCommand(cmd);
				assert.ok(true);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (/no active git repo|not in a Git repository/i.test(msg)) {
					assert.ok(true, 'Expected fail-fast for missing repo');
				} else {
					throw err;
				}
			}
		});
	}

	test('every package.json contributes.commands has a handler', async () => {
		const ext = vscode.extensions.getExtension(EXTENSION_ID);
		const declared: string[] = (ext!.packageJSON.contributes?.commands ?? [])
			.map((c: { command: string }) => c.command);
		const registered = new Set(await vscode.commands.getCommands());
		const orphaned = declared.filter((c) => !registered.has(c));
		assert.deepStrictEqual(orphaned, []);
	});

	test('every menu-referenced command exists in registry', async () => {
		const ext = vscode.extensions.getExtension(EXTENSION_ID);
		const menus: Record<string, Array<{ command: string }>> =
			ext!.packageJSON.contributes?.menus ?? {};
		const registered = new Set(await vscode.commands.getCommands());
		const allMenuCmds = new Set<string>();
		for (const items of Object.values(menus)) {
			for (const item of items) {
				allMenuCmds.add(item.command);
			}
		}
		const orphaned = Array.from(allMenuCmds).filter((c) => !registered.has(c));
		assert.deepStrictEqual(orphaned, []);
	});
});
