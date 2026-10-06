import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLetterPdf } from '../resume/pdf-write';
import { buildZip } from '../resume/zip-write';
import { POSTING_NOTES, needsModel, readPostingFile, savedPostingJob, savedPostingNote, type PostingRead } from './posting-file';

const NOW = new Date(Date.UTC(2026, 9, 6, 12));
const BODY = 'You will own the payments ledger, its APIs and its on-call rota, working with two product teams. '.repeat(4).trim();
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const docx = (paragraphs: string[]): Uint8Array =>
  buildZip([
    {
      name: 'word/document.xml',
      data: Buffer.from(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
          .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
          .join('')}</w:body></w:document>`,
      ),
    },
  ]);
const ok = (read: PostingRead): Extract<PostingRead, { ok: true }> => {
  assert.equal(read.ok, true, read.ok ? '' : read.why);
  return read as Extract<PostingRead, { ok: true }>;
};

describe('readPostingFile', () => {
  it('reads text and Markdown as they are, a BOM and Windows line ends aside', async () => {
    const got = ok(await readPostingFile('txt', bytes(`﻿Backend Engineer\r\n\r\n${BODY}`), NOW));
    assert.equal(got.text, `Backend Engineer\n\n${BODY}`);
    assert.equal(got.address, null);
    assert.equal(ok(await readPostingFile('md', bytes(`# Backend Engineer\n\n${BODY}`), NOW)).text.startsWith('# Backend Engineer'), true);
  });

  it('reads a saved page through its structured block and its address', async () => {
    const html = `<html><head><link rel="canonical" href="https://jobs.example/1"><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Backend Engineer', hiringOrganization: 'Acme', description: BODY })}</script></head><body>${BODY}</body></html>`;
    const got = ok(await readPostingFile('html', bytes(html), NOW));
    assert.equal(got.address, 'https://jobs.example/1');
    assert.equal(got.facts?.company, 'Acme');
    assert.equal(needsModel(got), false);
  });

  it('reads a PDF with a text layer and a .docx', async () => {
    assert.match(ok(await readPostingFile('pdf', buildLetterPdf(`Backend Engineer\n\n${BODY}`), NOW)).text, /payments ledger/);
    assert.match(ok(await readPostingFile('docx', docx(['Backend Engineer', BODY]), NOW)).text, /^Backend Engineer\n/);
  });

  it('says why a file gave no posting, and never throws for what a file holds', async () => {
    assert.deepEqual(await readPostingFile('txt', bytes('Call me back.'), NOW), { ok: false, why: POSTING_NOTES.tooShort });
    assert.deepEqual(await readPostingFile('pdf', bytes('%PDF-1.4 not really'), NOW), { ok: false, why: POSTING_NOTES.pdf });
    assert.deepEqual(await readPostingFile('docx', bytes('PK not a zip'), NOW), { ok: false, why: POSTING_NOTES.docx });
    assert.deepEqual(await readPostingFile('html', bytes('<html><body><nav>Home</nav></body></html>'), NOW), { ok: false, why: POSTING_NOTES.tooShort });
  });
});

describe('savedPostingJob', () => {
  const file = { companyId: 7, relPath: 'saved/Senior_PHP_Developer at Acme.pdf', mtimeMs: Date.UTC(2026, 9, 5) };
  const plain = { ok: true as const, text: BODY, address: null, addressIsOwn: false, facts: null, pageTitle: null };

  it('takes what the page said first, a model’s reading second', () => {
    const page = { ...plain, address: 'https://jobs.example/9', addressIsOwn: true, facts: { title: 'Page Title', company: 'Page Co', location: null, workplace: 'REMOTE' as const, postedAt: null } };
    const job = savedPostingJob(file, page, { title: 'Model Title', company: 'Model Co', location: 'Berlin', workplace: 'hybrid' });
    assert.deepEqual(
      [job.title, job.employer, job.location, job.locationHints?.workplace, job.url],
      ['Page Title', 'Page Co', 'Berlin', 'REMOTE', 'https://jobs.example/9'],
    );
    assert.equal(job.sourceFile, 'saved/Senior_PHP_Developer at Acme.pdf');
    assert.equal(job.handPicked, true);
    assert.equal(job.companyId, 7);
  });

  it('falls back to the file’s name for a title and to its time for a date; names no employer nobody named', () => {
    const job = savedPostingJob(file, plain, null);
    assert.equal(job.title, 'Senior PHP Developer at Acme');
    assert.equal(job.employer, null);
    assert.equal(job.postedAt.getTime(), file.mtimeMs);
    assert.equal(job.url, '');
    assert.equal(job.locationHints, undefined);
    assert.match(savedPostingNote(job), /company not named; the file gives no address/);
  });

  it('keys a posting by its own address, so the same page saved twice is one job', () => {
    const page = { ...plain, address: 'https://jobs.example/9', addressIsOwn: true };
    const a = savedPostingJob(file, page, null);
    const b = savedPostingJob({ ...file, relPath: 'other.html' }, { ...page, text: `${BODY} (edited)` }, null);
    assert.equal(a.externalId, b.externalId);
    assert.notEqual(savedPostingJob(file, plain, null).externalId, a.externalId);
    assert.match(a.externalId, /^saved-[0-9a-f]{16}$/);
  });

  it('keys by the text when the address is a careers page many postings share', () => {
    const shared = { ...plain, address: 'https://careers.example/', addressIsOwn: false };
    const one = savedPostingJob(file, shared, null);
    const other = savedPostingJob(file, { ...shared, text: `${BODY} Another role entirely.` }, null);
    assert.notEqual(one.externalId, other.externalId);
    assert.equal(one.url, 'https://careers.example/');
  });

  it('never keys by what a model said: a title worded differently is the same job', () => {
    const first = savedPostingJob(file, plain, { title: 'Senior PHP Dev', company: 'Acme', location: null, workplace: null });
    const again = savedPostingJob(file, plain, { title: 'Senior PHP Developer', company: 'Acme', location: null, workplace: null });
    assert.equal(first.externalId, again.externalId);
  });

  it('asks a model only when the page did not say both its title and its company', () => {
    const facts = { title: 'T', company: null, location: null, workplace: null, postedAt: null };
    assert.equal(needsModel(plain), true);
    assert.equal(needsModel({ ...plain, facts }), true);
    assert.equal(needsModel({ ...plain, facts: { ...facts, company: 'C' } }), false);
  });
});
