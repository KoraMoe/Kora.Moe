/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { SwSubscriptionsRepository } from '@/models/_.js';
import type { MiAccessToken } from '@/models/AccessToken.js';
import type { MiLocalUser } from '@/models/User.js';
import type { PushNotificationService } from '@/core/PushNotificationService.js';
import Unregister from './unregister.js';

function setup() {
	const repository = mock<SwSubscriptionsRepository>();
	const push = mock<PushNotificationService>();
	repository.findBy.mockResolvedValue([]);
	return { repository, push, endpoint: new Unregister(repository, push) };
}

describe('sw/unregister client version compatibility', () => {
	test('legacy account credentials only remove the current account', async () => {
		const { repository, endpoint } = setup();
		await endpoint.exec({ endpoint: 'https://push.example/subscription' }, { id: 'alice' } as MiLocalUser, null);
		expect(repository.findBy).toHaveBeenCalledWith({ userId: 'alice', endpoint: 'https://push.example/subscription' });
	});

	test.each([{}, { auth: 'secret' }, { publickey: 'key' }])('anonymous requests require both keys: %j', async keys => {
		const { repository, endpoint } = setup();
		await expect(endpoint.exec({ endpoint: 'https://push.example/subscription', ...keys }, null, null)).rejects.toMatchObject({ code: 'SUBSCRIPTION_KEYS_REQUIRED' });
		expect(repository.findBy).not.toHaveBeenCalled();
	});

	test('partial account keys are rejected rather than falling back to legacy mode', async () => {
		const { repository, endpoint } = setup();
		await expect(endpoint.exec({ endpoint: 'https://push.example/subscription', auth: 'secret' }, { id: 'alice' } as MiLocalUser, null)).rejects.toMatchObject({ code: 'SUBSCRIPTION_KEYS_REQUIRED' });
		expect(repository.findBy).not.toHaveBeenCalled();
	});

	test('application tokens cannot use the legacy credential-only path', async () => {
		const { repository, endpoint } = setup();
		await expect(endpoint.exec({ endpoint: 'https://push.example/subscription' }, { id: 'alice' } as MiLocalUser, {} as MiAccessToken)).rejects.toMatchObject({ code: 'SUBSCRIPTION_KEYS_REQUIRED' });
		expect(repository.findBy).not.toHaveBeenCalled();
	});

	test('anonymous requests match all subscription credentials and refresh each account', async () => {
		const { repository, push, endpoint } = setup();
		repository.findBy.mockResolvedValue([{ id: 'one', userId: 'alice' }, { id: 'two', userId: 'bob' }] as Awaited<ReturnType<SwSubscriptionsRepository['findBy']>>);
		const params = { endpoint: 'https://push.example/subscription', auth: 'secret', publickey: 'key' };
		await endpoint.exec(params, null, null);
		expect(repository.findBy).toHaveBeenCalledWith(params);
		expect(repository.delete).toHaveBeenCalledWith(['one', 'two']);
		expect(push.refreshCache).toHaveBeenCalledWith('alice');
		expect(push.refreshCache).toHaveBeenCalledWith('bob');
	});

	test('new authenticated clients still match their account and both keys', async () => {
		const { repository, endpoint } = setup();
		const params = { endpoint: 'https://push.example/subscription', auth: 'secret', publickey: 'key' };
		await endpoint.exec(params, { id: 'alice' } as MiLocalUser, null);
		expect(repository.findBy).toHaveBeenCalledWith({ ...params, userId: 'alice' });
	});
});
