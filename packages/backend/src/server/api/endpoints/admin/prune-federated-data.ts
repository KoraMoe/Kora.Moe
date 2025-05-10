/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DataRetentionService } from '@/core/DataRetentionService.js';

export const meta = {
	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:prune-federated-data',

	tags: ['admin'],

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			message: {
				type: 'string',
			},
			queued: {
				type: 'boolean',
			},
		},
		required: ['message', 'queued'],
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		daysToKeep: { type: 'integer', minimum: 1, default: 180 },
		pruneNotes: { type: 'boolean', default: true },
		pruneUsers: { type: 'boolean', default: true },
		pruneFiles: { type: 'boolean', default: true },
	},
	required: ['daysToKeep'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private dataRetentionService: DataRetentionService,
	) {
		super(meta, paramDef, async (ps) => {
			return await this.dataRetentionService.pruneOldFederatedData(ps);
		});
	}
}
