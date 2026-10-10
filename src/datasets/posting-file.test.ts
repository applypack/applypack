import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLetterPdf } from '../resume/pdf-write';
import { buildZip } from '../resume/zip-write';
import { simhash64 } from '../fingerprint';
import { hashShortId } from '../text-utils';
import { POSTING_NOTES, identifyPosting, needsModel, readPostingFile, savedPostingJob, savedPostingNote, type PostingRead, type StoredPosting } from './posting-file';

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
  });

  it('does not unpack a .docx that is megabytes inside: such a file is no posting, and reading it is the cost (#400)', async () => {
    // 111 KB on disk inflated to 32 MB, 3.4 s and 2.2 GB in the worker; here 3 MB of paragraphs, refused at the inflater.
    const paragraph = 'Senior engineer wanted for a platform team; remote in Europe. ';
    const big = docx(Array.from({ length: 50 }, () => paragraph.repeat(1000)));
    const started = Date.now();
    const read = await readPostingFile('docx', big, NOW);
    assert.deepEqual(read, { ok: false, why: POSTING_NOTES.docxTooLarge });
    assert.match(POSTING_NOTES.docxTooLarge, /more than 2 MB of document inside/);
    assert.ok(Date.now() - started < 1000, 'refused before the document is parsed');
    assert.deepEqual(await readPostingFile('html', bytes('<html><body><nav>Home</nav></body></html>'), NOW), { ok: false, why: POSTING_NOTES.tooShort });
  });
});

describe('savedPostingJob', () => {
  const file = { companyId: 7, relPath: 'saved/Senior_PHP_Developer at Acme.pdf', mtimeMs: Date.UTC(2026, 9, 5) };
  const plain = { ok: true as const, text: BODY, address: null, addressIsOwn: false, facts: null, pageTitle: null, earlierKey: BODY };

  it('takes what the page said first, a model’s reading second', () => {
    const page = { ...plain, address: 'https://jobs.example/9', addressIsOwn: true, facts: { title: 'Page Title', company: 'Page Co', location: null, workplace: 'REMOTE' as const, postedAt: null } };
    const job = savedPostingJob(file, page, { title: 'Model Title', company: 'Model Co', location: 'Berlin', workplace: 'hybrid' }, 'saved-1');
    assert.deepEqual(
      [job.title, job.employer, job.location, job.locationHints?.workplace, job.url, job.externalId],
      ['Page Title', 'Page Co', 'Berlin', 'REMOTE', 'https://jobs.example/9', 'saved-1'],
    );
    assert.equal(job.sourceFile, 'saved/Senior_PHP_Developer at Acme.pdf');
    assert.equal(job.handPicked, true);
    assert.equal(job.companyId, 7);
  });

  it('falls back to the file’s name for a title and to its time for a date; names no employer nobody named', () => {
    const job = savedPostingJob(file, plain, null, 'saved-1');
    assert.equal(job.title, 'Senior PHP Developer at Acme');
    assert.equal(job.employer, null);
    assert.equal(job.postedAt.getTime(), file.mtimeMs);
    assert.equal(job.url, '');
    assert.equal(job.locationHints, undefined);
    assert.match(savedPostingNote(job), /company not named; the file gives no address/);
  });

  it('asks a model only when the page did not say both its title and its company', () => {
    const facts = { title: 'T', company: null, location: null, workplace: null, postedAt: null };
    assert.equal(needsModel(plain), true);
    assert.equal(needsModel({ ...plain, facts }), true);
    assert.equal(needsModel({ ...plain, facts: { ...facts, company: 'C' } }), false);
  });
});

describe('identifyPosting', () => {
  type Read = Extract<PostingRead, { ok: true }>;
  const plain: Read = { ok: true, text: BODY, address: null, addressIsOwn: false, facts: null, pageTitle: null, earlierKey: BODY };
  const says = (title: string, location: string | null = null) => ({ title, company: 'Acme', location, workplace: null, postedAt: null });
  const idOf = (read: Read, relPath = 'a.html'): string => identifyPosting(relPath, read, []).externalId;
  const stored = (externalId: string, more: Partial<StoredPosting> = {}): StoredPosting => ({ externalId, title: 'Backend Engineer', employer: 'Acme', url: '', sourceFile: 'first.html', fingerprint: null, ...more });
  /** The id a version up to 2.55.11 gave: the page's own address as written, else its text. */
  const earlierId = (key: string): string => `saved-${hashShortId(key)}`;

  // A posting long enough to have a fingerprint, as real ones are.
  const POSTING = [
    'Senior Backend Engineer, Payments',
    'We are looking for an engineer to own the ledger that every payout of ours goes through. You will design its APIs with two product teams, keep its on-call rota humane, and decide what we build next quarter.',
    'What you bring: five years of backend work in TypeScript or Go, strong SQL on Postgres, and the habit of writing down why a decision was made. Experience with double-entry bookkeeping is welcome and not required.',
    'What we offer: a salary band stated in the first call, thirty days of leave, a remote team spread across Europe, and a yearly budget for conferences and books.',
    'How we hire: a thirty-minute call, a paid exercise of about three hours, a conversation with the team, and an answer within a week.',
  ].join('\n\n');
  const OTHER = [
    'Product Designer, Onboarding',
    'You will redesign the first ten minutes a new customer spends with us: the sign-up, the bank connection and the first invoice. You will run the research yourself and ship with three engineers.',
    'What you bring: a portfolio that shows shipped flows and the numbers they moved, fluency in Figma, and comfort presenting half-finished work. A background in fintech helps.',
    'What we offer: hybrid work from the Lisbon office, private health cover, stock options, and a sabbatical month after four years.',
    'How we hire: portfolio review, a whiteboard session on a real problem of ours, two conversations with the team, and an offer within ten days.',
  ].join('\n\n');

  it('keys a posting by its own address, whatever campaign brought the reader to it', () => {
    const page = { ...plain, address: 'https://jobs.example/9', addressIsOwn: true };
    assert.match(idOf(page), /^saved-[0-9a-f]{16}$/);
    assert.equal(idOf({ ...page, address: 'https://jobs.example/9?utm_source=newsletter&gh_src=abc', text: `${BODY} (edited)` }), idOf(page));
    assert.equal(idOf({ ...page, address: 'https://JOBS.example/9/' }), idOf(page));
    assert.notEqual(idOf({ ...page, address: 'https://jobs.example/10' }), idOf(page));
    assert.notEqual(idOf(plain), idOf(page));
  });

  it('keys by the text when the address is a careers page many postings share', () => {
    const shared = { ...plain, address: 'https://careers.example/', addressIsOwn: false };
    assert.notEqual(idOf(shared), idOf({ ...shared, text: `${BODY} Another role entirely.` }));
    // As every version did: a text file stored before is found under the same id.
    assert.equal(idOf(shared), earlierId(BODY));
  });

  it('keeps one opening’s two cities apart, though they share a description', () => {
    const berlin = { ...plain, facts: says('Backend Engineer (Berlin)', 'Berlin') };
    assert.notEqual(idOf(berlin), idOf({ ...plain, facts: says('Backend Engineer (Munich)', 'Munich') }));
    assert.notEqual(idOf({ ...plain, facts: says('Backend Engineer', 'Berlin') }), idOf({ ...plain, facts: says('Backend Engineer', 'Munich') }));
    assert.equal(idOf(berlin), idOf({ ...berlin }, 'saved-again.html'));
  });

  it('keeps two postings apart when both name the careers page as their address', () => {
    const root = { ...plain, address: 'https://acme.example/careers', addressIsOwn: true };
    assert.notEqual(idOf({ ...root, facts: says('Data Engineer') }), idOf({ ...root, facts: says('Platform Engineer') }));
  });

  it('finds the job a file already is, by its id', () => {
    const job = stored(idOf(plain));
    assert.deepEqual(identifyPosting('copy.txt', plain, [stored('saved-other'), job]), { externalId: job.externalId, known: job });
    assert.deepEqual(identifyPosting('copy.txt', plain, [stored('saved-other')]), { externalId: idOf(plain), known: null });
  });

  it('finds a job stored under the id an earlier version gave it', () => {
    const page = { ...plain, address: 'https://jobs.example/9?utm_source=x', addressIsOwn: true, facts: says('Backend Engineer'), earlierKey: 'https://jobs.example/9?utm_source=x' };
    const old = stored(earlierId('https://jobs.example/9?utm_source=x'));
    assert.notEqual(idOf(page), old.externalId);
    assert.deepEqual(identifyPosting('saved-again.html', page, [old]), { externalId: old.externalId, known: old });
    // A page that states no title was keyed by its address alone, and still is that job.
    assert.equal(identifyPosting('x.html', { ...page, facts: null }, [old]).known, old);
  });

  it('does not take another posting’s job for its own: the earlier id was shared by one opening’s two cities', () => {
    const munich = { ...plain, facts: says('Backend Engineer (Munich)', 'Munich') };
    const berlinStored = stored(earlierId(BODY), { title: 'Backend Engineer (Berlin)', sourceFile: 'berlin.html' });
    assert.deepEqual(identifyPosting('munich.html', munich, [berlinStored]), { externalId: idOf(munich), known: null });
    // Berlin's own file, read again, is still Berlin's job.
    assert.equal(identifyPosting('berlin.html', { ...plain, facts: says('Backend Engineer (Berlin)', 'Berlin') }, [berlinStored]).known, berlinStored);
  });

  it('knows a file whose text was added to as the posting it was', () => {
    const before = stored(earlierId(POSTING), { title: 'Read by a model', sourceFile: 'notes/role.md', fingerprint: simhash64(POSTING) });
    const noted: Read = { ...plain, text: `${POSTING}\n\nMy note: applied through a friend, follow up on Monday.`, earlierKey: '' };
    assert.notEqual(idOf(noted), before.externalId);
    assert.equal(identifyPosting('notes/role.md', noted, [before]).known, before);
    // The same text under another name is not asked how alike it is: two files, two jobs.
    assert.equal(identifyPosting('notes/other.md', noted, [before]).known, null);
  });

  it('takes another posting saved over the same name as a new job', () => {
    const before = stored(earlierId(POSTING), { sourceFile: 'job.txt', fingerprint: simhash64(POSTING) });
    assert.equal(identifyPosting('job.txt', { ...plain, text: OTHER, earlierKey: OTHER }, [before]).known, null);
    // A text too short to have a fingerprint is never called the same on likeness.
    assert.equal(simhash64(BODY), null);
    assert.equal(identifyPosting('job.txt', { ...plain, text: `${BODY} A note.`, earlierKey: '' }, [stored('saved-x', { sourceFile: 'job.txt' })]).known, null);
  });

  it('knows a few lines about a job by the notes kept under or over them, however short', () => {
    const before = stored(earlierId(BODY), { sourceFile: 'jobs/acme.md' });
    const under: Read = { ...plain, text: `${BODY}\n\n## Notes\n- called Dana on Tuesday\n- second round next week`, earlierKey: '' };
    const over: Read = { ...plain, text: `Applied 2026-10-06, waiting.\n\n${BODY}`, earlierKey: '' };
    assert.equal(identifyPosting('jobs/acme.md', under, [before]).known, before);
    assert.equal(identifyPosting('jobs/acme.md', over, [before]).known, before);
    // Written into the middle of it, a short text is no longer told from another posting.
    assert.equal(identifyPosting('jobs/acme.md', { ...plain, text: BODY.replace('ledger', 'ledger (ask about it)'), earlierKey: '' }, [before]).known, null);
    // More than a note under it is another document that happens to quote the posting.
    assert.equal(identifyPosting('jobs/acme.md', { ...plain, text: `${BODY}\n${'x'.repeat(5_000)}`, earlierKey: '' }, [before]).known, null);
    assert.equal(identifyPosting('jobs/other.md', under, [before]).known, null);
  });

  it('knows a page saved again over itself by the title it states', () => {
    const before = stored('saved-before', { title: 'Backend Engineer', sourceFile: 'page.html' });
    const again = { ...plain, text: `Posted 12 days ago. ${BODY}`, facts: says('Backend Engineer'), earlierKey: '' };
    assert.equal(identifyPosting('page.html', again, [before]).known, before);
    assert.equal(identifyPosting('page.html', { ...again, facts: says('Staff Backend Engineer') }, [before]).known, null);
    // The same title at another company, saved over the same name, is another posting.
    assert.equal(identifyPosting('page.html', { ...again, facts: { ...says('Backend Engineer'), company: 'Globex' } }, [before]).known, null);
    assert.equal(identifyPosting('page.html', { ...again, facts: { ...says('Backend Engineer'), company: null } }, [before]).known, before);
  });

  it('prefers the newest of the jobs one file became', () => {
    const [newer, older] = [stored('saved-2', { sourceFile: 'page.html' }), stored('saved-1', { sourceFile: 'page.html' })];
    assert.equal(identifyPosting('page.html', { ...plain, facts: says('Backend Engineer'), earlierKey: '' }, [newer, older]).known, newer);
  });
});
