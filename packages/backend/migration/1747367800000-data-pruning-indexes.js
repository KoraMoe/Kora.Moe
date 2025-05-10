/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { isConcurrentIndexMigrationEnabled } from "./js/migration-config.js";

export class DataPruningIndexes1747367800000 {
	name = 'DataPruningIndexes1747367800000';
	transaction = isConcurrentIndexMigrationEnabled() ? false : undefined;

	async up(queryRunner) {
		const concurrently = isConcurrentIndexMigrationEnabled() ? 'CONCURRENTLY' : '';

		// Basic note pruning indexes
		await queryRunner.query(`CREATE INDEX ${concurrently} "IDX_NOTE_UPDATED_AT" ON "note" ("updatedAt")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_note_id_composite" ON "note" (id, "userId", "userHost", "renoteId", "replyId")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_note_renote_reply" ON "note" ("renoteId", "replyId")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_note_fileids" ON "note" USING gin ("fileIds")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_note_id_range" ON "note" (id DESC)`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_note_userid_composite" ON "note" ("userId", "userHost", "hasPoll") WHERE "hasPoll" = true OR "userHost" IS NULL`);

		// Related note tables indexes
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_note_reaction_noteid" ON "note_reaction" ("noteId")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_note_favorite_noteid" ON "note_favorite" ("noteId")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_clip_note_noteid" ON "clip_note" ("noteId")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_note_unread_noteid" ON "note_unread" ("noteId")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_note_watching_noteid" ON "note_watching" ("noteId")`);

		// User pruning indexes
		await queryRunner.query(`CREATE INDEX ${concurrently} "IDX_USER_LAST_FETCHED_AT" ON "user" ("lastFetchedAt")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "IDX_USER_REMOTE_ACTIVITY" ON "user" ("host", "lastActiveDate", "lastFetchedAt") WHERE "host" IS NOT NULL`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_user_avatar_banner" ON "user" ("avatarId", "bannerId")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_user_host_composite" ON "user" (host, "followersCount", "followingCount")`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_user_id_host_counts" ON "user" (id, host, "followersCount", "followingCount")`);

		// Drive file pruning indexes
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_drive_file_id_range" ON "drive_file" (id DESC)`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_drive_file_link_host_id" ON "drive_file" ("isLink", "userHost", id) WHERE "isLink" IS TRUE AND "userHost" IS NOT NULL`);
		await queryRunner.query(`CREATE INDEX ${concurrently} "idx_drive_file_link_host_id_btree" ON "drive_file" (id) WHERE "isLink" IS TRUE AND "userHost" IS NOT NULL`);

		// Flush all cached Linear Scan Plans and redo statistics for tables
		await queryRunner.query(`ANALYZE "user", "note", "drive_file", "note_reaction", "note_favorite", "clip_note", "note_unread", "note_watching"`);
	}

	async down(queryRunner) {
		// Drop all the indexes in reverse order
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_drive_file_link_host_id_btree"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_drive_file_link_host_id"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_drive_file_id_range"`);

		await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_id_host_counts"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_host_composite"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_avatar_banner"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_USER_REMOTE_ACTIVITY"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_USER_LAST_FETCHED_AT"`);

		await queryRunner.query(`DROP INDEX IF EXISTS "idx_note_watching_noteid"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_note_unread_noteid"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_clip_note_noteid"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_note_favorite_noteid"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_note_reaction_noteid"`);

		await queryRunner.query(`DROP INDEX IF EXISTS "idx_note_userid_composite"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_note_id_range"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_note_fileids"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_note_renote_reply"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_note_id_composite"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_NOTE_UPDATED_AT"`);
	}
}
