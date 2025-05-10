/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { QueueService } from '@/core/QueueService.js';
import { bindThis } from '@/decorators.js';
import Logger from '@/logger.js';

@Injectable()
export class DataRetentionService {
	private logger: Logger;

	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private queueService: QueueService,
	) {
		this.logger = new Logger('dataRetention');
	}

	@bindThis
	public async getDatabaseSummary(): Promise<{
		totalSize: number;
		cachedSize: number;
		localSize: number;
		tableStats: Record<string, { size: number; count: number }>;
	}> {
		// Get all tables and their sizes
		const tableStats = await this.db.query(`
			SELECT relname AS "table", reltuples as "count", pg_total_relation_size(C.oid) AS "size"
			FROM pg_class C LEFT JOIN pg_namespace N ON (N.oid = C.relnamespace)
			WHERE nspname NOT IN ('pg_catalog', 'information_schema')
				AND C.relkind <> 'i'
				AND nspname !~ '^pg_toast';
		`).then(recs => {
			const res = {} as Record<string, { count: number; size: number }>;
			for (const rec of recs) {
				res[rec.table] = {
					count: parseInt(rec.count, 10),
					size: parseInt(rec.size, 10),
				};
			}
			return res;
		});

		// Calculate total size
		const totalSize = Object.values(tableStats).reduce((sum, tableInfo) => sum + tableInfo.size, 0);

		// Tables likely to contain federated data
		const federatedTables = ['note', 'user', 'instance', 'drive_file'];

		// Estimate the cached size (sum of sizes of tables that primarily store federated data)
		const cachedSize = federatedTables.reduce((sum, tableName) => {
			const tableInfo = tableStats[tableName];
			return sum + (tableInfo ? tableInfo.size : 0);
		}, 0);

		// Calculate local data size
		const localSize = totalSize - cachedSize;

		return {
			totalSize,
			cachedSize,
			localSize,
			tableStats,
		};
	}

	@bindThis
	public async pruneOldFederatedData(options: {
		daysToKeep: number;
		pruneNotes?: boolean;
		pruneUsers?: boolean;
		pruneFiles?: boolean;
	}): Promise<{
			message: string;
			queued: boolean;
		}> {
		const { daysToKeep, pruneNotes = true, pruneUsers = true, pruneFiles = true } = options;

		// Queue the data pruning job
		await this.queueService.dbQueue.add('prune-federated-data', {
			daysToKeep,
			pruneNotes,
			pruneUsers,
			pruneFiles,
		}, {
			removeOnComplete: {
				age: 3600 * 24 * 7, // keep up to 7 days
				count: 30,
			},
			removeOnFail: {
				age: 3600 * 24 * 7, // keep up to 7 days
				count: 100,
			},
		});

		this.logger.info(`Queued federated data pruning (daysToKeep: ${daysToKeep})`);

		return {
			message: `Data pruning job queued. Remote data older than ${daysToKeep} days will be pruned.`,
			queued: true,
		};
	}

	@bindThis
	public async executePruneOldFederatedData(options: {
		daysToKeep: number;
		pruneNotes?: boolean;
		pruneUsers?: boolean;
		pruneFiles?: boolean;
	}): Promise<{
			notesDeleted: number;
			usersDeleted: number;
			filesDeleted: number;
			chartsDeleted?: number;
		}> {
		const { daysToKeep, pruneNotes = true, pruneUsers = true, pruneFiles = true } = options;
		const thresholdDate = new Date();
		thresholdDate.setDate(thresholdDate.getDate() - daysToKeep);

		let notesDeleted = 0;
		let usersDeleted = 0;
		let filesDeleted = 0;
		let chartsDeleted = 0;
		let collectedFileIds: string[] = []; // Store fileIds from deleted notes

		try {
			// Prune remote notes older than the threshold with improved integrity checks
			if (pruneNotes) {
				// Step 1: Find candidate notes for deletion
				const candidateNotes = await this.db.query(`
					SELECT n.id
					FROM note n
					WHERE n.uri IS NOT NULL
					AND (n."updatedAt" IS NULL OR n."updatedAt" < $1)
					LIMIT 10000`, [thresholdDate]);

				if (candidateNotes.length > 0) {
					const noteIds = candidateNotes.map((n: { id: string }) => n.id);

					// Step 2: Check for pinned notes (these should never be deleted)
					const pinnedNoteIds = await this.db.query(`
						SELECT "noteId" FROM user_note_pining
						WHERE "noteId" = ANY($1)`, [noteIds]);

					const pinnedNoteIdSet = new Set(pinnedNoteIds.map((p: { noteId: string }) => p.noteId));

					// Step 3: Check for reactions, favorites, clips (flagged notes)
					const flaggedNoteIds = await this.db.query(`
						SELECT DISTINCT "noteId"
						FROM (
							SELECT "noteId" FROM note_reaction WHERE "noteId" = ANY($1)
							UNION ALL
							SELECT "noteId" FROM note_favorite WHERE "noteId" = ANY($1)
							UNION ALL
							SELECT "noteId" FROM clip_note WHERE "noteId" = ANY($1)
						) AS combined_flags`, [noteIds]);

					const flaggedNoteIdSet = new Set(flaggedNoteIds.map((f: { noteId: string }) => f.noteId));

					// Step 4: Identify important users (local or with following/followers)
					const notesWithUserInfo = await this.db.query(`
						SELECT n.id, n."userId", u.host, u."followersCount", u."followingCount"
						FROM note n
						JOIN "user" u ON n."userId" = u.id
						WHERE n.id = ANY($1)`, [noteIds]);

					// Build a map of notes to delete (excluding notes from important users)
					const notesToDelete = notesWithUserInfo
						.filter((note: {
							id: string;
							host: string | null;
							followersCount: number;
							followingCount: number;
						}) => {
							// Keep notes that are pinned or have reactions/favorites
							if (pinnedNoteIdSet.has(note.id) || flaggedNoteIdSet.has(note.id)) {
								return false;
							}

							// Keep notes from local users
							if (note.host === null) {
								return false;
							}

							// Keep notes from users with followers/following
							if ((note.followersCount + note.followingCount) > 0) {
								return false;
							}

							return true;
						})
						.map((note: { id: string }) => note.id);

					// Perform deletion in batches to avoid overloading the database
					if (notesToDelete.length > 0) {
						// Get files that might need cleanup
						const noteFiles = await this.db.query(`
							SELECT "fileIds" FROM note WHERE id = ANY($1) AND "fileIds" <> '{}'`, [notesToDelete]);

						// Collect all file IDs
						const fileIdsToCheck = noteFiles.reduce((acc: string[], note: { fileIds: string[] }) => [...acc, ...note.fileIds], [] as string[]);

						// Save the file IDs for potential cleanup in the pruneFiles step
						if (fileIdsToCheck.length > 0 && pruneFiles) {
							this.logger.info(`Marked ${fileIdsToCheck.length} files for potential cleanup`);
							// Store these fileIds for later pruning
							collectedFileIds = [...collectedFileIds, ...fileIdsToCheck];
						}

						// Delete the notes
						const result = await this.db.query(`
							DELETE FROM note
							WHERE id = ANY($1)
							RETURNING id`, [notesToDelete]);

						// Delete corresponding note history entries
						const historyResult = await this.db.query(`
							DELETE FROM note_history
							WHERE "targetId" = ANY($1)
							RETURNING id`, [notesToDelete]);

						const historyDeleted = historyResult.length;
						notesDeleted = result.length;
						this.logger.info(`Deleted ${notesDeleted} remote notes and ${historyDeleted} history entries older than ${daysToKeep} days`);
					} else {
						this.logger.info(`No remote notes to delete older than ${daysToKeep} days (all in use)`);
					}
				}
			}

			// Prune remote users who haven't been active for longer than the threshold
			if (pruneUsers) {
				// Only delete users who:
				// 1. Are remote (host IS NOT NULL)
				// 2. Haven't been active or fetched recently
				// 3. Have no followers or following relationships
				// 4. Have no notes (to prevent orphaned notes)
				const result = await this.db.query(`
					DELETE FROM "user"
					WHERE host IS NOT NULL
					AND ("lastActiveDate" IS NULL OR "lastActiveDate" < $1)
					AND ("lastFetchedAt" IS NULL OR "lastFetchedAt" < $1)
					AND "id" NOT IN (
						SELECT "followerId" FROM following
						UNION
						SELECT "followeeId" FROM following
					)
					AND "notesCount" = 0
					RETURNING id`, [thresholdDate]);

				usersDeleted = result.length;
				this.logger.info(`Deleted ${usersDeleted} inactive remote users older than ${daysToKeep} days`);
			}

			// Prune orphaned drive files from remote sources
			if (pruneFiles) {
				this.logger.info('Starting improved file pruning process...');

				// Generate ID range based on threshold date
				const startDate = new Date();
				startDate.setFullYear(startDate.getFullYear() - 10); // Go back 10 years for start ID
				const startId = this.generateIdFromDate(startDate);
				const endId = this.generateIdFromDate(thresholdDate);

				this.logger.info(`Scanning files in ID range: ${startId} - ${endId}`);

				// Step 1: Get count of candidate files
				const countQuery = `
					SELECT COUNT(*) as count
					FROM drive_file
					WHERE id BETWEEN $1 AND $2
					AND "isLink" IS TRUE
					AND "userHost" IS NOT NULL
				`;

				const countResult = await this.db.query(countQuery, [startId, endId]);
				const totalCount = parseInt(countResult[0].count, 10);

				this.logger.info(`Found ${totalCount} files to process within ID range`);

				// Process in batches
				const batchSize = 1000;
				let processedFiles = 0;
				let deletedFiles = 0;
				let lastId = startId;

				while (processedFiles < totalCount) {
					// Get a batch of files using ID range
					const fileBatchQuery = `
						SELECT id
						FROM drive_file
						WHERE id >= $1
						AND id <= $2
						AND "isLink" IS TRUE
						AND "userHost" IS NOT NULL
						ORDER BY id
						LIMIT $3
					`;

					const fileBatch = await this.db.query(fileBatchQuery, [lastId, endId, batchSize]);

					if (fileBatch.length === 0) break;

					const fileIds = fileBatch.map((f: { id: string }) => f.id);
					lastId = fileIds[fileIds.length - 1];

					// Check file references in notes
					const referencedInNotesQuery = `
						WITH file_refs AS (
							SELECT unnest(n."fileIds") as file_id, count(*) as ref_count
							FROM note n
							WHERE n."fileIds" && $1
							GROUP BY unnest(n."fileIds")
						)
						SELECT f.id, COALESCE(fr.ref_count, 0) as ref_count
						FROM unnest($2::text[]) as f(id)
						LEFT JOIN file_refs fr ON fr.file_id = f.id
					`;

					const referencedResults = await this.db.query(referencedInNotesQuery, [fileIds, fileIds]);
					const fileReferences: Record<string, number> = {};

					for (const row of referencedResults) {
						fileReferences[row.id] = parseInt(row.ref_count, 10);
					}

					// Check if files are used as avatars or banners
					const usedAsAvatarBannerQuery = `
						SELECT DISTINCT "avatarId", "bannerId"
						FROM public.user
						WHERE "avatarId" = ANY($1) OR "bannerId" = ANY($1)
					`;

					const avatarBannerResults = await this.db.query(usedAsAvatarBannerQuery, [fileIds]);
					const usedAsAvatarBanner = new Set<string>();

					for (const row of avatarBannerResults) {
						if (row.avatarId) usedAsAvatarBanner.add(row.avatarId);
						if (row.bannerId) usedAsAvatarBanner.add(row.bannerId);
					}

					// Find orphaned files (no references and not used as avatar/banner)
					const orphanedFileIds = fileIds.filter((id: string) =>
						fileReferences[id] === 0 && !usedAsAvatarBanner.has(id),
					);

					// Delete orphaned files
					if (orphanedFileIds.length > 0) {
						const deleteQuery = `
							WITH batch_ids AS (
								SELECT unnest($1::text[]) AS id
							)
							DELETE FROM drive_file df
							USING batch_ids b
							WHERE df.id = b.id
							RETURNING id
						`;

						const deleteResult = await this.db.query(deleteQuery, [orphanedFileIds]);
						deletedFiles += deleteResult.length;
					}

					processedFiles += fileIds.length;
					this.logger.info(`Processed ${processedFiles}/${totalCount} files, deleted ${deletedFiles} orphaned files`);
				}

				filesDeleted = deletedFiles;
				this.logger.info(`File pruning complete. Total deleted: ${filesDeleted} orphaned remote files`);

				// Process any collected fileIds from deleted notes
				if (collectedFileIds.length > 0) {
					this.logger.info(`Checking ${collectedFileIds.length} files from deleted notes...`);

					// Check if collected files are still referenced anywhere
					const referencedInNotesQuery = `
						WITH file_refs AS (
							SELECT unnest(n."fileIds") as file_id, count(*) as ref_count
							FROM note n
							WHERE n."fileIds" && $1
							GROUP BY unnest(n."fileIds")
						)
						SELECT f.id, COALESCE(fr.ref_count, 0) as ref_count
						FROM unnest($2::text[]) as f(id)
						LEFT JOIN file_refs fr ON fr.file_id = f.id
					`;

					const referencedResults = await this.db.query(referencedInNotesQuery, [collectedFileIds, collectedFileIds]);
					const fileReferences: Record<string, number> = {};

					for (const row of referencedResults) {
						fileReferences[row.id] = parseInt(row.ref_count, 10);
					}

					// Check if files are used as avatars or banners
					const usedAsAvatarBannerQuery = `
						SELECT DISTINCT "avatarId", "bannerId"
						FROM public.user
						WHERE "avatarId" = ANY($1) OR "bannerId" = ANY($1)
					`;

					const avatarBannerResults = await this.db.query(usedAsAvatarBannerQuery, [collectedFileIds]);
					const usedAsAvatarBanner = new Set<string>();

					for (const row of avatarBannerResults) {
						if (row.avatarId) usedAsAvatarBanner.add(row.avatarId);
						if (row.bannerId) usedAsAvatarBanner.add(row.bannerId);
					}

					// Filter to only remote linked files that are not referenced
					const orphanedFileIdsQuery = `
						SELECT id FROM drive_file
						WHERE id = ANY($1)
						AND "isLink" IS TRUE
						AND "userHost" IS NOT NULL
					`;

					const potentialOrphanedFileIds = collectedFileIds.filter(id =>
						fileReferences[id] === 0 && !usedAsAvatarBanner.has(id),
					);

					if (potentialOrphanedFileIds.length > 0) {
						const orphanedFileIdsResult = await this.db.query(orphanedFileIdsQuery, [potentialOrphanedFileIds]);
						const fileIdsToDelete = orphanedFileIdsResult.map((f: { id: string }) => f.id);

						if (fileIdsToDelete.length > 0) {
							const deleteQuery = `
								WITH batch_ids AS (
									SELECT unnest($1::text[]) AS id
								)
								DELETE FROM drive_file df
								USING batch_ids b
								WHERE df.id = b.id
								RETURNING id
							`;

							const deleteResult = await this.db.query(deleteQuery, [fileIdsToDelete]);
							const additionalDeleted = deleteResult.length;
							filesDeleted += additionalDeleted;
							this.logger.info(`Deleted ${additionalDeleted} additional files from notes`);
						}
					}
				}
			}

			// Clean old chart data using the same threshold date
			try {
				this.logger.info('Starting chart data pruning process...');
				const timestampInSeconds = Math.floor(thresholdDate.getTime() / 1000);

				// Delete from chart tables
				const chartTables = [
					'__chart__hashtag',
					'__chart_day__hashtag',
					'__chart__per_user_notes',
					'__chart_day__per_user_notes',
					'__chart__instance',
				];

				for (const table of chartTables) {
					try {
						const result = await this.db.query(`
							DELETE FROM ${table}
							WHERE "date" < $1
							RETURNING id
						`, [timestampInSeconds]);

						chartsDeleted += result.length;
						this.logger.info(`Deleted ${result.length} records from ${table} older than ${daysToKeep} days`);
					} catch (tableError) {
						// If one table has an error, continue with others
						this.logger.error(`Error pruning chart table ${table}: ${tableError}`, {
							error: tableError,
							table,
						});
					}
				}

				this.logger.info(`Chart data pruning complete. Total deleted: ${chartsDeleted} records`);
			} catch (error) {
				this.logger.error(`Error pruning chart data: ${error}`, { error });
				// Don't throw the error, we still want to return the other stats
			}

			return {
				notesDeleted,
				usersDeleted,
				filesDeleted,
				chartsDeleted,
			};
		} catch (error) {
			this.logger.error(`Error pruning federated data: ${error}`, {
				error,
				...options,
			});
			throw error;
		}
	}

	private generateIdFromTimestamp(timestamp: number): string {
		// Convert timestamp to misskey ID format, which is a timestamp-based ID
		// This uses a shortened version for simplicity - similar to how Misskey generates IDs
		return (timestamp << 16 | (Math.random() * 65535 & 0xffff)).toString();
	}

	private generateIdFromDate(date: Date): string {
		// Convert date to misskey ID format, which is a timestamp-based ID
		// This uses a shortened version for simplicity - similar to how Misskey generates IDs
		const timestamp = Math.floor(date.getTime() / 1000);
		return (timestamp << 16 | (Math.random() * 65535 & 0xffff)).toString();
	}
}
