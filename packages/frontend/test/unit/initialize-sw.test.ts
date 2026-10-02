/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@@/js/config.js', () => ({ lang: 'en-US' }));

beforeEach(() => vi.resetModules());
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function setup() {
	const active = { postMessage: vi.fn() };
	const registration = { active, update: vi.fn().mockResolvedValue(undefined) };
	const serviceWorker = Object.assign(new EventTarget(), {
		controller: null as typeof active | null,
		register: vi.fn().mockResolvedValue(registration),
		ready: Promise.resolve(registration),
	});
	vi.stubGlobal('navigator', { serviceWorker });
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	return { active, registration, serviceWorker };
}

describe('service worker initialization', () => {
	test('bypasses the HTTP cache and sends language to the active worker', async () => {
		const { active, serviceWorker } = setup();
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await initializeSw();
		await initializeSw();
		expect(serviceWorker.register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/', type: 'classic', updateViaCache: 'none' });
		expect(active.postMessage).toHaveBeenCalledWith({ msg: 'initialize', lang: 'en-US' });
	});

	test('initializes the new controller without reloading the page', async () => {
		const { serviceWorker } = setup();
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await initializeSw();
		const controller = { postMessage: vi.fn() };
		serviceWorker.controller = controller;
		serviceWorker.dispatchEvent(new Event('controllerchange'));
		expect(controller.postMessage).toHaveBeenCalledWith({ msg: 'initialize', lang: 'en-US' });
	});

	test('checks updates on foreground resume and catches offline rejection', async () => {
		const { registration } = setup();
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await initializeSw();
		registration.update.mockRejectedValue(new Error('offline'));
		vi.spyOn(window.document, 'visibilityState', 'get').mockReturnValue('visible');
		window.document.dispatchEvent(new Event('visibilitychange'));
		await Promise.resolve();
		expect(registration.update).toHaveBeenCalledOnce();
		expect(console.warn).toHaveBeenCalledWith('Service worker update check failed', expect.any(Error));
	});

	test('catches registration denial and allows a later retry', async () => {
		const { serviceWorker } = setup();
		serviceWorker.register.mockRejectedValueOnce(new Error('denied'));
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await expect(initializeSw()).resolves.toBeUndefined();
		await initializeSw();
		expect(serviceWorker.register).toHaveBeenCalledTimes(2);
	});

	test('allows browsers without service worker support to boot', async () => {
		vi.stubGlobal('navigator', {});
		const { initializeSw } = await import('@/utility/initialize-sw.js');
		await expect(initializeSw()).resolves.toBeUndefined();
	});
});
