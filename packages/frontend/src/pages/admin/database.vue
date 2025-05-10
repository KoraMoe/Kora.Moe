<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 800px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<div style="margin-bottom: 24px;">
			<MkSection v-if="dbSummary" :key="'db-summary'" :title="i18n.ts.databaseSummary">
				<!-- Database Statistics Cards -->
				<div class="database-stats">
					<div class="stat-card">
						<div class="stat-title">{{ i18n.ts.totalDatabaseSize }}</div>
						<div class="stat-value">{{ bytes(dbSummary.totalSize) }}</div>
					</div>
					<div class="stat-card">
						<div class="stat-title">{{ i18n.ts.estimatedCacheSize }}</div>
						<div class="stat-value">{{ bytes(dbSummary.cachedSize) }}</div>
						<div class="stat-subtext">{{ Math.round((dbSummary.cachedSize / dbSummary.totalSize) * 100) }}%</div>
					</div>
					<div class="stat-card">
						<div class="stat-title">{{ i18n.ts.estimatedLocalDataSize }}</div>
						<div class="stat-value">{{ bytes(dbSummary.localSize) }}</div>
					</div>
				</div>

				<!-- Data Cleanup Section -->
				<div class="data-cleanup-section">
					<div class="section-header">
						<i class="ti ti-trash"></i> {{ i18n.ts.dataCleanup }}
					</div>

					<MkInfo style="margin-bottom: 16px;">{{ i18n.ts.federatedDataCleanupDescription }}</MkInfo>

					<div class="cleanup-controls">
						<div class="days-to-keep">
							<MkInput v-model="daysToKeep" type="number" :min="1" class="daysToKeepInput">
								<template #label>{{ i18n.ts.daysToKeepRemoteData }}</template>
							</MkInput>
						</div>

						<div class="cleanup-options">
							<div class="option-label">{{ i18n.ts.dataTypesToClean }}:</div>
							<div class="options-grid">
								<MkSwitch v-model="pruneNotes">{{ i18n.ts.pruneRemoteNotes }}</MkSwitch>
								<MkSwitch v-model="pruneUsers">{{ i18n.ts.pruneRemoteUsers }}</MkSwitch>
								<MkSwitch v-model="pruneFiles">{{ i18n.ts.pruneRemoteFiles }}</MkSwitch>
							</div>
						</div>

						<div class="action-buttons">
							<MkButton :disabled="isCleaningUp" :primary="true" class="cleanupButton" @click="startCleanup">
								<i class="ti ti-trash"></i> {{ i18n.ts.startCleanup }}
							</MkButton>
						</div>
					</div>

					<MkInfo v-if="cleanupStatus" class="cleanup-status">{{ cleanupStatus }}</MkInfo>
				</div>
			</MkSection>
		</div>

		<div style="margin-bottom: 24px;">
			<MkSection :key="'table-stats'" :title="i18n.ts.tableStats">
				<FormSuspense v-slot="{ result: database }" :p="databasePromiseFactory">
					<MkKeyValue v-for="table in database" :key="table[0]" oneline style="margin: 1em 0;">
						<template #key>{{ table[0] }}</template>
						<template #value>{{ bytes(table[1].size) }} ({{ number(table[1].count) }} recs)</template>
					</MkKeyValue>
				</FormSuspense>
			</MkSection>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, onMounted } from 'vue';
import FormSuspense from '@/components/form/suspense.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkSection from '@/components/form/section.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import bytes from '@/filters/bytes.js';
import number from '@/filters/number.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { definePage } from '@/page.js';

const databasePromiseFactory = () => misskeyApi('admin/get-table-stats').then(res => Object.entries(res).sort((a, b) => b[1].size - a[1].size));

// Database summary data
const dbSummary = ref(null);
const fetchDatabaseSummary = async () => {
	try {
		dbSummary.value = await misskeyApi('admin/database-summary');
	} catch (error) {
		console.error('Error fetching database summary:', error);
		os.alert({
			type: 'error',
			text: i18n.ts.errorFetchingDbSummary,
		});
	}
};

// Data cleanup variables
const daysToKeep = ref(180);
const pruneNotes = ref(true);
const pruneUsers = ref(true);
const pruneFiles = ref(true);
const isCleaningUp = ref(false);
const cleanupStatus = ref('');

const startCleanup = async () => {
	const { canceled } = await os.confirm({
		type: 'warning',
		title: i18n.ts.confirmDataCleanupTitle,
		text: i18n.ts.confirmDataCleanupText.replace('{0}', daysToKeep.value.toString()),
	});

	if (canceled) return;

	isCleaningUp.value = true;
	cleanupStatus.value = i18n.ts.cleanupInProgress;

	try {
		const response = await misskeyApi('admin/prune-federated-data', {
			daysToKeep: parseInt(daysToKeep.value.toString()),
			pruneNotes: pruneNotes.value,
			pruneUsers: pruneUsers.value,
			pruneFiles: pruneFiles.value,
		});

		cleanupStatus.value = response.message;

		// Refresh the database summary after a moment
		window.setTimeout(() => {
			fetchDatabaseSummary();
		}, 2000);
	} catch (error) {
		console.error('Error starting cleanup:', error);
		cleanupStatus.value = i18n.ts.cleanupError;
		os.alert({
			type: 'error',
			text: i18n.ts.cleanupError,
		});
	} finally {
		isCleaningUp.value = false;
	}
};

onMounted(() => {
	fetchDatabaseSummary();
});

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.database,
	icon: 'ti ti-database',
}));
</script>

<style lang="scss" scoped>
.database-stats {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 16px;
	margin-bottom: 24px;
}

.stat-card {
	background: var(--bg);
	border-radius: 8px;
	padding: 16px;
	border: 1px solid var(--divider);
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;

	.stat-title {
		font-size: 0.9em;
		opacity: 0.8;
		margin-bottom: 8px;
	}

	.stat-value {
		font-size: 1.5em;
		font-weight: bold;
	}

	.stat-subtext {
		margin-top: 4px;
		font-size: 0.9em;
		opacity: 0.7;
	}
}

.data-cleanup-section {
	background: var(--panel);
	border-radius: 8px;
	padding: 16px;

	.section-header {
		font-size: 1.1em;
		font-weight: bold;
		margin-bottom: 16px;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.cleanup-controls {
		margin-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.option-label {
		margin-bottom: 8px;
		font-weight: bold;
	}

	.options-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 8px;
	}

	.action-buttons {
		margin-top: 8px;

		.cleanupButton {
			margin-top: 8px;
		}
	}

	.cleanup-status {
		margin-top: 16px;
	}
}

.days-to-keep {
	.daysToKeepInput {
		max-width: 200px;
	}
}

@media (max-width: 600px) {
	.database-stats {
		grid-template-columns: 1fr;
	}
}
</style>
