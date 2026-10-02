/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import MkPushNotificationAllowButton from '@/components/MkPushNotificationAllowButton.vue';

vi.mock('@@/js/config.js', () => ({ instanceName: 'SW Test' }));
vi.mock('@/i.js', () => ({ $i: null }));
vi.mock('@/instance.js', () => ({ instance: { swPublickey: null } }));
vi.mock('@/os.js', () => ({ apiWithDialog: vi.fn(), promiseDialog: vi.fn(), alert: vi.fn() }));
vi.mock('@/accounts.js', () => ({ getAccounts: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/components/MkButton.vue', () => ({ default: { template: '<button><slot/></button>' } }));
vi.mock('@/i18n.js', () => ({ i18n: { ts: { pushNotificationNotSupported: 'Unsupported' } } }));

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0));

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('Safari push feature detection', () => {
	test('Service Workers without PushManager render the unsupported state', async () => {
		const ready = vi.fn();
		vi.stubGlobal('PushManager', undefined);
		vi.stubGlobal('navigator', { serviceWorker: { get ready() { ready(); return Promise.resolve({}); } } });
		const view = render(MkPushNotificationAllowButton);
		await flushPromises();
		expect(view.getByText('Unsupported')).toBeTruthy();
		expect(ready).not.toHaveBeenCalled();
	});

	test('missing registration pushManager does not throw', async () => {
		vi.stubGlobal('PushManager', class {});
		vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({}) } });
		const view = render(MkPushNotificationAllowButton);
		await flushPromises();
		expect(view.getByText('Unsupported')).toBeTruthy();
	});

	test('Safari permission denial is caught and leaves the button unsupported', async () => {
		vi.stubGlobal('PushManager', class {});
		vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockRejectedValue(new Error('denied')) } }) } });
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const view = render(MkPushNotificationAllowButton);
		await flushPromises();
		expect(view.getByText('Unsupported')).toBeTruthy();
		expect(warning).toHaveBeenCalledWith('Push notification initialization failed', expect.any(Error));
	});
});
