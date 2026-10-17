/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import type { SwSubscriptionsRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { PushNotificationService } from '@/core/PushNotificationService.js';

export const meta = {
	tags: ['account'],

	// ブラウザ側の購読解除時に、同一ブラウザに登録された全アカウント分の登録を消せるように、
	// 資格情報ではなく購読のauth secret (RFC 8291) で所有を確認する
	requireCredential: false,

	limit: {
		duration: ms('1hour'),
		max: 30,
	},

	description: 'Unregister from receiving push notifications.',

	errors: {
		subscriptionKeysRequired: {
			message: 'Subscription keys are required without an account credential.',
			code: 'SUBSCRIPTION_KEYS_REQUIRED',
			id: '5fc9531c-2dea-48c3-b3da-973f62a76b47',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		endpoint: { type: 'string' },
		auth: { type: 'string' },
		publickey: { type: 'string' },
	},
	required: ['endpoint'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.swSubscriptionsRepository)
		private swSubscriptionsRepository: SwSubscriptionsRepository,

		private pushNotificationService: PushNotificationService,
	) {
		super(meta, paramDef, async (ps, me, token) => {
			const hasKeys = ps.auth != null && ps.publickey != null;
			if (!hasKeys && (me == null || token != null || ps.auth != null || ps.publickey != null)) {
				throw new ApiError(meta.errors.subscriptionKeysRequired);
			}

			// Legacy authenticated clients sent only endpoint. Never remove other accounts.
			const subscriptions = await this.swSubscriptionsRepository.findBy({
				...(me ? { userId: me.id } : {}),
				endpoint: ps.endpoint,
				...(hasKeys ? { auth: ps.auth, publickey: ps.publickey } : {}),
			});

			if (subscriptions.length === 0) return;

			await this.swSubscriptionsRepository.delete(subscriptions.map(s => s.id));

			for (const userId of new Set(subscriptions.map(s => s.userId))) {
				this.pushNotificationService.refreshCache(userId);
			}
		});
	}
}
