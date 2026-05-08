const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',
	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`[ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	// Extension host bundle (Node.js)
	const extCtx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
	});

	// Webview bundle (browser IIFE — React bundled in, no CDN)
	const webCtx = await esbuild.context({
		entryPoints: ['src/webview/index.tsx'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview.js',
		jsx: 'automatic',
		logLevel: 'silent',
		legalComments: production ? 'none' : 'inline',
		define: {
			'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
		},
		plugins: [esbuildProblemMatcherPlugin],
	});

	if (watch) {
		await Promise.all([extCtx.watch(), webCtx.watch()]);
	} else {
		await extCtx.rebuild();
		await extCtx.dispose();
		await webCtx.rebuild();
		await webCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
