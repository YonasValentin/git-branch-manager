import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('yonasvalentinmougaardkristensen.git-branch-manager-pro'));
	});

	test('Commands should be registered', async () => {
		const commands = await vscode.commands.getCommands();
		assert.ok(commands.includes('git-branch-manager.cleanup'));
		assert.ok(commands.includes('git-branch-manager.quickCleanup'));
		assert.ok(commands.includes('git-branch-manager.createBranch'));
	});
});
