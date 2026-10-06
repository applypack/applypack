import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BROWSER_KEYS, englishModule } from '../web/browser-messages';

/*
 * Writes src/web/public/i18n-en.mjs: the English of the page modules, from
 * the catalog's `browser.*` keys (ADR 0061, stage 3). public/ is served as
 * it is, so the module is committed; run this after adding or changing a
 * `browser.*` message — src/web/i18n-browser.test.ts fails until you do.
 *
 *   npm run i18n:browser
 */

const OUT = join(__dirname, '..', 'web', 'public', 'i18n-en.mjs');

writeFileSync(OUT, englishModule());
console.log(`i18n-en.mjs: ${BROWSER_KEYS.length} browser messages`);
