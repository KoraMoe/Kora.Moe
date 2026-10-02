/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { lang } from '@@/js/config.js';

let initialized = false;

export async function initializeSw() {
	if (!('serviceWorker' in navigator) || initialized) return;
	initialized = true;

	try {
		const registration = await navigator.serviceWorker.register('/sw.js', {
			scope: '/',
			type: 'classic',
			updateViaCache: 'none',
		});
		const initialize = () => {
			(navigator.serviceWorker.controller ?? registration.active)?.postMessage({
				msg: 'initialize',
				lang,
			});
		};
		navigator.serviceWorker.addEventListener('controllerchange', initialize);
		void navigator.serviceWorker.ready.then(initialize).catch(error => {
			console.warn('Service worker initialization failed', error);
		});

		// Safari can suspend background tabs / installed PWAs for a long time.
		window.document.addEventListener('visibilitychange', () => {
			if (window.document.visibilityState !== 'visible') return;
			void registration.update().catch(error => {
				console.warn('Service worker update check failed', error);
			});
		});
	} catch (error) {
		initialized = false;
		console.warn('Service worker registration failed', error);
	}
}
