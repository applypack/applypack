import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * Imported first by route-smoke.ts, before anything reads the configuration:
 * the one folder this run's folder source may read (ADR 0062). Outside the
 * launcher only the roots APPLYPACK_INBOX_ROOTS names are read, and CI names
 * none.
 */
process.env.APPLYPACK_INBOX_ROOTS ??= join(tmpdir(), `applypack-smoke-inbox-${process.pid}`);
