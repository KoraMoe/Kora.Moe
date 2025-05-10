/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as Bull from 'bullmq';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import Logger from '@/logger.js';
import { DataRetentionService } from '@/core/DataRetentionService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';
import type { PruneFederatedDataJobData } from '../types.js';

@Injectable()
export class PruneFederatedDataProcessorService {
	private logger: Logger;

	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private queueLoggerService: QueueLoggerService,
		private dataRetentionService: DataRetentionService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('prune-federated-data');
	}

	@bindThis
	public async process(job: Bull.Job<PruneFederatedDataJobData>): Promise<void> {
		this.logger.info('Pruning old federated data...');

		const { daysToKeep, pruneNotes, pruneUsers, pruneFiles } = job.data;

		try {
			const result = await this.dataRetentionService.executePruneOldFederatedData({
				daysToKeep,
				pruneNotes,
				pruneUsers,
				pruneFiles,
			});

			this.logger.succ('Successfully pruned old federated data', {
				daysToKeep,
				...result,
			});
		} catch (error) {
			this.logger.error(`Error pruning old federated data: ${error}`, {
				error,
				daysToKeep,
				pruneNotes,
				pruneUsers,
				pruneFiles,
			});
			throw error;
		}
	}
}
