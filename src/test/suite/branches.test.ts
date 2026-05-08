import * as assert from 'assert';
import { createTempRepo, type TempRepo } from '../fixtures/setupRepo';
import { getBranchInfo } from '../../git';

suite('getBranchInfo against real git', () => {
	let repo: TempRepo;

	teardown(() => {
		repo?.cleanup();
	});

	test('returns empty array when only default branches exist (main is protected)', async () => {
		repo = createTempRepo();
		const branches = await getBranchInfo(repo.path);
		assert.strictEqual(branches.length, 0);
	});

	test('detects feature branches (excludes protected default)', async () => {
		repo = createTempRepo({ branches: ['feat/a', 'feat/b'] });
		const branches = await getBranchInfo(repo.path);
		const names = branches.map((b) => b.name).sort();
		assert.deepStrictEqual(names, ['feat/a', 'feat/b']);
	});

	test('marks merged branches', async () => {
		repo = createTempRepo({ branches: ['feat/done'] });
		repo.git(['merge', '--no-ff', 'feat/done', '-m', 'Merge feat/done']);
		const branches = await getBranchInfo(repo.path);
		const merged = branches.find((b) => b.name === 'feat/done');
		assert.ok(merged);
		assert.strictEqual(merged!.isMerged, true);
	});

	test('marks current branch', async () => {
		repo = createTempRepo({ branches: ['feat/x', 'feat/y'] });
		repo.git(['checkout', 'feat/x']);
		const branches = await getBranchInfo(repo.path);
		const current = branches.find((b) => b.isCurrentBranch);
		assert.strictEqual(current!.name, 'feat/x');
	});

	test('handles branch with slashes in name', async () => {
		repo = createTempRepo({ branches: ['feat/nested/path'] });
		const branches = await getBranchInfo(repo.path);
		const branch = branches.find((b) => b.name === 'feat/nested/path');
		assert.ok(branch, 'Expected to find feat/nested/path');
	});

	test('reports daysOld of 0 for fresh commits', async () => {
		repo = createTempRepo({ branches: ['fresh'] });
		const branches = await getBranchInfo(repo.path);
		const fresh = branches.find((b) => b.name === 'fresh');
		assert.ok(fresh!.daysOld <= 1, `Expected daysOld <= 1, got ${fresh!.daysOld}`);
	});

	test('reports author from committer', async () => {
		repo = createTempRepo({ branches: ['feat/x'] });
		const branches = await getBranchInfo(repo.path);
		const branch = branches.find((b) => b.name === 'feat/x');
		assert.strictEqual(branch!.author, 'Test');
	});

	test('reports ahead/behind counts as numbers', async () => {
		repo = createTempRepo({ branches: ['feat/x'] });
		const branches = await getBranchInfo(repo.path);
		const branch = branches.find((b) => b.name === 'feat/x');
		assert.strictEqual(typeof branch!.ahead, 'number');
		assert.strictEqual(typeof branch!.behind, 'number');
	});

	test('does not throw on minimal repo', async () => {
		repo = createTempRepo({ commits: 1 });
		const branches = await getBranchInfo(repo.path);
		assert.ok(Array.isArray(branches));
	});

	test('detects unicode branch names', async () => {
		repo = createTempRepo();
		repo.git(['checkout', '-b', 'feat/日本語']);
		const branches = await getBranchInfo(repo.path);
		const branch = branches.find((b) => b.name === 'feat/日本語');
		assert.ok(branch, 'Expected to find unicode branch');
	});
});
