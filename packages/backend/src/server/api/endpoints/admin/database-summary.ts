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
	secure: true,
	kind: 'read:admin:database-summary',

	tags: ['admin'],

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			totalSize: {
				type: 'number',
			},
			cachedSize: {
				type: 'number',
			},
			localSize: {
				type: 'number',
			},
			tableStats: {
				type: 'object',
				additionalProperties: {
					type: 'object',
					properties: {
						count: {
							type: 'number',
						},
						size: {
							type: 'number',
						},
					},
					required: ['count', 'size'],
				},
			},
		},
		required: ['totalSize', 'cachedSize', 'localSize', 'tableStats'],
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private dataRetentionService: DataRetentionService,
	) {
		super(meta, paramDef, async () => {
			return await this.dataRetentionService.getDatabaseSummary();
		});
	}
}
