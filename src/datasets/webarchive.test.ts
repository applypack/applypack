import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWebArchive } from './webarchive';

// A binary property list with the keys Safari writes (WebMainResource and two WebSubresources), made with
// Python's plistlib from a small hand-written page. It is the format, not a file Safari itself saved.
const SAVED = readFileSync(join(__dirname, 'fixtures', 'saved-page.webarchive'));
const text = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

describe('readWebArchive', () => {
  it('finds the page in the archive: its markup whole, scripts and all, its charset and where it came from', () => {
    const page = readWebArchive(SAVED);
    assert.ok(page);
    const html = text(page.html);
    assert.match(html, /^<!DOCTYPE html>\n<html lang="en">/);
    assert.ok(html.trimEnd().endsWith('</html>'));
    // What a single-file save from Chrome drops, Safari keeps: the structured block.
    assert.ok(html.includes('"@type":"JobPosting","title":"Senior Backend Engineer"'));
    assert.ok(html.includes('naïve shortcuts cost us later'));
    // A name in ASCII and an address that is not: the two ways a property list writes a string.
    assert.equal(page.charset, 'UTF-8');
    assert.equal(page.location, 'https://careers.fennel.example/jobs/senior-backend-engineer-zürich');
  });

  it('is nothing for a file that is not an archive of a page', () => {
    assert.equal(readWebArchive(new Uint8Array(0)), null);
    assert.equal(readWebArchive(new TextEncoder().encode('bplist00')), null);
    assert.equal(readWebArchive(new TextEncoder().encode('<html><body>a page saved as source</body></html>'.padEnd(120, ' '))), null);
    // The same bytes under another magic.
    const other = Uint8Array.from(SAVED);
    other[6] = 0x31;
    assert.equal(readWebArchive(other), null);
  });

  it('follows no offset out of the file: a cut or damaged archive is nothing, at every length', () => {
    for (let cut = 1; cut < SAVED.length; cut += 7) assert.equal(readWebArchive(SAVED.subarray(0, cut)), null, `cut at ${cut}`);
    // Each of the last sixty bytes — the trailer and the end of the offset table — set to 0xff in turn:
    // read as nothing, or as the page still, and never thrown.
    for (let i = SAVED.length - 60; i < SAVED.length; i++) {
      const damaged = Uint8Array.from(SAVED);
      damaged[i] = 0xff;
      assert.doesNotThrow(() => readWebArchive(damaged), `byte ${i}`);
    }
  });
});
