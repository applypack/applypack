import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractResumeText, ACCEPTED_EXTENSIONS } from './resume-text';
import { ResumeTextError } from './docx-text';

/**
 * What the reader does with a file that is not what it claims to be.
 * Every path here has to end in a ResumeTextError the upload form can show —
 * anything else reaches the user as a 500 on a file they chose themselves.
 */
const PROSE = 'Senior engineer with ten years of Laravel and React work. '.repeat(6);

async function refusal(name: string, bytes: Buffer): Promise<string> {
  try {
    await extractResumeText(name, bytes);
    assert.fail(`${name} was read instead of refused`);
  } catch (err) {
    assert.ok(err instanceof ResumeTextError, `${name} threw ${(err as Error).constructor.name}`);
    return err.message;
  }
}

describe('extractResumeText — the files a user actually picks', () => {
  it('reads plain text and markdown', async () => {
    assert.match(await extractResumeText('cv.txt', Buffer.from(PROSE)), /Laravel/);
    assert.match(await extractResumeText('cv.md', Buffer.from(`# CV\n\n${PROSE}`)), /Laravel/);
  });

  it('normalises Windows line endings', async () => {
    const text = await extractResumeText('cv.txt', Buffer.from(PROSE.replace(/ /g, '\r\n')));
    assert.doesNotMatch(text, /\r/);
  });

  it('refuses an empty file', async () => {
    for (const ext of ACCEPTED_EXTENSIONS) {
      assert.ok((await refusal(`cv${ext}`, Buffer.alloc(0))).length > 0);
    }
  });

  it('refuses a file with too little text to be a resume', async () => {
    assert.match(await refusal('cv.txt', Buffer.from('Nazar Boyko')), /characters/);
  });

  it('refuses a .docx that is not a zip', async () => {
    assert.match(await refusal('cv.docx', Buffer.from(PROSE)), /not a valid \.docx/);
  });

  it('refuses a .docx that is a zip without a document', async () => {
    // A real .docx fixture renamed is fine; a zip of something else is not.
    const notWord = readFileSync('src/resume/fixtures/flow-simple.docx');
    const truncated = notWord.subarray(0, Math.floor(notWord.length / 2));
    assert.ok((await refusal('cv.docx', truncated)).length > 0);
  });

  it('refuses a .pdf that is really a zip, and says so as a PDF problem', async () => {
    const zip = readFileSync('src/resume/fixtures/flow-simple.docx');
    assert.ok((await refusal('cv.pdf', zip)).length > 0);
  });

  it('names the extensions it does take', async () => {
    const message = await refusal('cv.pages', Buffer.from(PROSE));
    for (const ext of ACCEPTED_EXTENSIONS) assert.ok(message.includes(ext), `${ext} not named`);
  });

  it('refuses a file with no extension at all', async () => {
    assert.match(await refusal('resume', Buffer.from(PROSE)), /Unsupported file type/);
  });
});
