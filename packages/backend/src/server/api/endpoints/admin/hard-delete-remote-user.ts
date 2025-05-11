/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ApPersonService } from '@/core/activitypub/models/ApPersonService.js';
import { QueueService } from '@/core/QueueService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:delete-account',

	errors: {
		noSuchUser: {
			message: 'No such user.',
			code: 'NO_SUCH_USER',
			id: 'b851d00b-8ab1-4a56-8b1b-e5c3566da3e3',
		},
		localUser: {
			message: 'This user is local.',
			code: 'LOCAL_USER',
			id: '4362f8dc-731f-4ad8-a694-be2a2c1ecdf6',
		},
		cantDelete: {
			message: 'Failed to delete.',
			code: 'CANT_DELETE',
			id: '5dbf082d-559f-4d3d-9761-014f437e0b75',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		refetch: { type: 'boolean', default: false },
	},
	required: ['userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> {
	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private queueService: QueueService,
		private apPersonService: ApPersonService,
		private moderationLogService: ModerationLogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// Get user
			const user = await this.usersRepository.findOneBy({ id: ps.userId });
			if (user == null) {
				throw new ApiError(meta.errors.noSuchUser);
			}

			// Check if the user is remote
			if (user.host === null) {
				throw new ApiError(meta.errors.localUser);
			}

			// Store the URI for potential re-fetching
			const uri = user.uri;

			// Log the action
			this.moderationLogService.log(me, 'deleteAccount', {
				userId: user.id,
				userUsername: user.username,
				userHost: user.host,
			});

			// Update user as deleted first to prevent interactions while deletion is in progress
			await this.usersRepository.update(user.id, {
				isDeleted: true,
			});

			// Hard delete the user including all their data
			await this.queueService.createDeleteAccountJob(user, {
				soft: false, // Override the default behavior for remote users
			});

			// If refetch is requested, schedule the re-fetch
			if (ps.refetch && uri) {
				// Note: We're not waiting for the deletion to complete, as that could take time.
				// The re-fetch will be scheduled after a short delay to allow deletion to progress
				setTimeout(async () => {
					try {
						await this.apPersonService.resolvePerson(uri);
					} catch (err) {
						// Just log errors, since this is happening in a background process
						console.error(`Failed to refetch user ${uri}:`, err);
					}
				}, 5000); // 5 second delay to allow deletion to make progress

				return { message: 'User deletion in progress, refetch scheduled' };
			}

			return { message: 'User deletion job has been queued' };
		});
	}
}
