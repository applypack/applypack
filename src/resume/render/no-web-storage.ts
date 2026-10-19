/*
 * Imported by clean-docx.ts before `docx`, so every process that loads it is
 * covered: a once-script, `node dist/...` in Docker, the tests (#610). Node 25
 * turned Web Storage on, and docx's bundled util-deprecate reads
 * `global.localStorage` as it loads: without `--localstorage-file` the read
 * prints "ExperimentalWarning: localStorage is not available". Nothing here
 * uses it, so the global goes, as the launcher's `--no-experimental-webstorage`
 * takes it (`local/supervise.ts`), with no flag an older Node could refuse.
 * Deleted, not set to undefined: Node 26 would load it on the next read.
 */
delete (globalThis as { localStorage?: unknown }).localStorage;
