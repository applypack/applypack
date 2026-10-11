import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMhtml } from './mhtml';

// Written by a real browser (Chrome 154, `Page.captureSnapshot`) from a small page with a JobPosting block in it.
const SAVED = readFileSync(join(__dirname, 'fixtures', 'saved-page.mhtml'));
const text = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

describe('readMhtml', () => {
  it('finds the page in a file a browser saved: its markup whole, its letters right, and where it came from', () => {
    const page = readMhtml(SAVED);
    assert.ok(page);
    const html = text(page.html);
    assert.match(html, /^<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Type" content="text\/html; charset=UTF-8">/);
    // Lines the browser folded at 76 characters are whole again, and what it wrote as =C3=BC is ü.
    assert.ok(html.includes('working with two product teams in Zürich and Київ.</p>'));
    assert.ok(html.includes('CHF 130 000 – 150 000'));
    assert.ok(html.trimEnd().endsWith('</body></html>'));
    assert.doesNotMatch(html, /=3D|=\r?\n|MultipartBoundary/);
    assert.deepEqual([page.location, page.charset], ['http://127.0.0.1:4850/posting.html', null]);
  });

  it('shows what such a file does not hold: the browser left every script out, the posting block with them', () => {
    assert.doesNotMatch(text(readMhtml(SAVED)!.html), /<script|JobPosting/);
  });

  it('reads the same file with bare line feeds, as a checkout or a sync may leave it', () => {
    const unix = Buffer.from(SAVED.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    const page = readMhtml(unix);
    assert.ok(page);
    assert.equal(text(page.html).replace(/\r\n/g, '\n'), text(readMhtml(SAVED)!.html).replace(/\r\n/g, '\n'));
  });

  it('reads the older one-part form, a base64 part, and the charset a part names', () => {
    const single = 'From: <Saved by Windows Internet Explorer>\r\nContent-Type: text/html;\r\n\tcharset="windows-1251"\r\nContent-Transfer-Encoding: quoted-printable\r\nContent-Location: https://jobs.example/7\r\n\r\n<html><body>=CA=E8=BF=E2</body></html>';
    const one = readMhtml(Buffer.from(single, 'latin1'));
    assert.deepEqual([one?.charset, one?.location, new TextDecoder('windows-1251').decode(one!.html)], ['windows-1251', 'https://jobs.example/7', '<html><body>Київ</body></html>']);
    const encoded = Buffer.from('<html><body>Zürich</body></html>', 'utf8').toString('base64');
    const multi = `MIME-Version: 1.0\nContent-Type: multipart/related; boundary=XX\n\n--XX\nContent-Type: text/css\n\nbody{}\n--XX\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${encoded}\n--XX--\n`;
    const second = readMhtml(Buffer.from(multi, 'latin1'));
    assert.deepEqual([text(second!.html), second?.charset, second?.location], ['<html><body>Zürich</body></html>', 'utf-8', null]);
  });

  it('answers null for what is no such file, and for one with no page in it', () => {
    assert.equal(readMhtml(Buffer.from('<html><body>just a page</body></html>')), null);
    assert.equal(readMhtml(Buffer.from('')), null);
    assert.equal(readMhtml(Buffer.from('Content-Type: multipart/related; boundary=XX\r\n\r\n--XX\r\nContent-Type: image/png\r\n\r\nabc\r\n--XX--\r\n')), null);
    assert.equal(readMhtml(Buffer.from('Content-Type: multipart/related\r\n\r\nno boundary named')), null);
    // A binary file (Safari's .webarchive opens "bplist00") has no head at all.
    assert.equal(readMhtml(Buffer.from([0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30, 0xd1, 0x01, 0x02, 0x00, 0x0a, 0x0a])), null);
  });
});
