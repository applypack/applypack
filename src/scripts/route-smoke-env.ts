import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * Imported first by route-smoke.ts, before anything reads the configuration:
 * the one folder this run's folder source may read (ADR 0062). Outside the
 * launcher only the roots APPLYPACK_INBOX_ROOTS names are read. The run makes
 * a fresh folder of its own and overrides whatever the environment named, so
 * it never writes into, or deletes, a folder somebody else uses.
 */
export const SMOKE_INBOX = mkdtempSync(join(tmpdir(), 'applypack-smoke-inbox-'));
process.env.APPLYPACK_INBOX_ROOTS = SMOKE_INBOX;
