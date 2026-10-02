/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * Language manager for SW
 */
import { get, set } from 'idb-keyval';
import { I18n } from '@@/js/i18n.js';
import { FETCH_TIMEOUT_MS } from '@/const.js';
import type { Locale } from 'i18n';

class SwLang {
	public cacheName = `mk-cache-${_VERSION_}`;

	public lang: Promise<string> = get('lang').catch(() => null).then(async prelang => {
		if (!prelang) return 'en-US';
		return prelang;
	});

	public async setLang(newLang: string): Promise<I18n<Locale>> {
		this.lang = Promise.resolve(newLang);
		await set('lang', newLang).catch(() => {});
		return this.fetchLocale();
	}

	public i18n: Promise<I18n<Locale>> | null = null;

	public fetchLocale(): Promise<I18n<Locale>> {
		return (this.i18n = this._fetch());
	}

	private async _fetch(): Promise<I18n<Locale>> {
		// Service Workerは何度も起動しそのたびにlocaleを読み込むので、CacheStorageを使う
		const localeUrl = `/assets/locales/${await this.lang}.${_VERSION_}.json`;
		let cache: Cache | undefined;
		let localeRes: Response | undefined;
		try {
			cache = await caches.open(this.cacheName);
			localeRes = await cache.match(localeUrl);
		} catch {
			// CacheStorage may be unavailable in Safari.
		}

		// _DEV_がtrueの場合は常に最新化
		if (!localeRes || _DEV_) {
			const controller = new AbortController();
			const timeout = globalThis.setTimeout(() => {
				controller.abort('locale-fetch-timeout');
			}, FETCH_TIMEOUT_MS);

			try {
				localeRes = await fetch(localeUrl, { signal: controller.signal });

				if (!localeRes.ok) throw new Error('locale fetching error');

				await cache?.put(localeUrl, localeRes.clone()).catch(() => {});
			} finally {
				globalThis.clearTimeout(timeout);
			}
		}

		return new I18n<Locale>(await localeRes.json());
	}
}

export const swLang = new SwLang();
