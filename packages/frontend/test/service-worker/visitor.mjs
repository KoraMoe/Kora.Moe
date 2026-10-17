/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Check the production client in WebKit with read-only, local API fixtures.
// Run `pnpm build` first. This does not exercise a real account, APNs, or an iPhone.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'built/_frontend_vite_/manifest.json'), 'utf8'));
const entry = manifest['src/_boot_.ts'];
const meta = {
	name: 'Safari smoke', version: '2026.10.0', description: 'Local browser regression fixture',
	clientOptions: { entrancePageStyle: 'simple', showActivitiesForVisitor: false },
	requireSetup: false, disableRegistration: true, federation: 'all',
	backgroundImageUrl: null, iconUrl: null, policies: {}, pinnedUsers: [],
	maintainerName: 'Test', maintainerEmail: null, repositoryUrl: 'https://github.com/misskey-dev/misskey',
	swPublickey: null, features: {}, serverRules: [],
};
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
	response.setHeader('Cache-Control', 'no-store');
	const pathname = new URL(request.url, 'http://localhost').pathname;
	try {
		if (pathname.startsWith('/api/')) {
			response.setHeader('Content-Type', 'application/json');
			response.end(JSON.stringify(pathname === '/api/meta' ? meta : pathname === '/api/emojis' ? { emojis: [] } : []));
			return;
		}
		const prefix = pathname.startsWith('/vite/') ? 'built/_frontend_vite_' : pathname.startsWith('/assets/') ? 'built/_frontend_dist_' : pathname === '/sw.js' ? 'built/_sw_dist_' : null;
		if (prefix) {
			const relativePath = pathname.replace(/^\/(vite|assets)\//, '');
			const base = resolve(root, prefix);
			const path = resolve(base, `.${relativePath.startsWith('/') ? relativePath : `/${relativePath}`}`);
			if (!path.startsWith(`${base}/`)) throw new Error('Invalid path');
			response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
			response.end(await readFile(path));
			return;
		}
		if (extname(pathname)) {
			response.writeHead(404).end();
			return;
		}
		response.setHeader('Content-Type', 'text/html');
		response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta property="og:site_name" content="Safari smoke"><script id="misskey_meta" type="application/json" data-generated-at="${Date.now()}">${JSON.stringify(meta)}</script>${(entry.css ?? []).map(css => `<link rel="stylesheet" href="/vite/${css}">`).join('')}<script type="module" src="/vite/${entry.file.replace('scripts/', 'en-US/')}"></script></head><body><div id="splash"></div></body></html>`);
	} catch {
		response.writeHead(404).end();
	}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await webkit.launch();
try {
	for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
		const context = await browser.newContext({ viewport, locale: 'en-US' });
		const page = await context.newPage();
		const errors = [];
		page.setDefaultTimeout(10_000);
		page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
		await page.goto(origin);
		await page.getByTestId('signin').waitFor();
		assert(await page.getByRole('heading', { name: 'Safari smoke', exact: true }).isVisible());
		await page.getByTestId('signin').click();
		await page.locator('input[autocomplete~="username"]').waitFor();
		assert(await page.locator('input[autocomplete~="username"]').isVisible());
		await page.getByTestId('bg').evaluate(async background => {
			await Promise.all(background.parentElement.getAnimations({ subtree: true })
				.filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
				.map(animation => animation.finished.catch(() => {})));
		});
		await page.screenshot({ path: `/tmp/pwp-webkit-${name}.png` });
		await page.reload();
		await page.getByTestId('signin').waitFor();
		await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
		assert.deepEqual(errors, []);
		console.log(`webkit ${name}: production boot, login dialog, reload and SW control PASS`);
		await context.close();
	}
} finally {
	await browser.close();
	await new Promise(resolve => server.close(resolve));
}
