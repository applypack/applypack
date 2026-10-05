import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FolderError, listFolder, readFolderFile, realFolder } from './folder-io';
import { MAX_FILE_BYTES } from './folder-scan';

/*
 * A real folder in the system's temp directory: links, depth and "the real
 * path lies beneath" are properties of a file system, not of a function's
 * arguments. Everything is made by the test and removed after it.
 */
let root = '';
let outside = '';
/** A system that will not make a link for this user (Windows without the right) cannot test what a link does. */
let links = true;

before(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'applypack-folder-')));
  outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'applypack-outside-')));
  await fs.mkdir(path.join(root, 'sub', 'deep', 'deeper'), { recursive: true });
  await fs.mkdir(path.join(root, '.cache'));
  await fs.writeFile(path.join(root, 'a.json'), '[{"title":"a"}]');
  await fs.writeFile(path.join(root, 'sub', 'b.csv'), 'title,url\nb,https://rows.example/b\n');
  await fs.writeFile(path.join(root, 'sub', 'deep', 'c.jsonl'), '{"title":"c"}\n');
  await fs.writeFile(path.join(root, 'sub', 'deep', 'deeper', 'd.json'), '[]');
  await fs.writeFile(path.join(root, '.hidden.json'), '[]');
  await fs.writeFile(path.join(root, '.cache', 'x.json'), '[]');
  await fs.writeFile(path.join(outside, 'secret.json'), '[{"title":"not yours to read"}]');
  await fs.mkdir(path.join(outside, 'dir'));
  await fs.writeFile(path.join(outside, 'dir', 'inner.json'), '[]');
  try {
    await fs.symlink(path.join(outside, 'secret.json'), path.join(root, 'link.json'));
    await fs.symlink(path.join(outside, 'dir'), path.join(root, 'linked-dir'));
  } catch {
    links = false;
  }
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe('listFolder', () => {
  it('lists regular files three folders deep, and passes over dotfiles, hidden folders and links', async () => {
    const files = await listFolder(root);
    assert.deepEqual(files.map((f) => f.relPath).sort(), ['a.json', 'sub/b.csv', 'sub/deep/c.jsonl']);
    const a = files.find((f) => f.relPath === 'a.json')!;
    assert.equal(a.size, 15);
    assert.equal(Number.isInteger(a.mtimeMs), true);
  });

  it('says a folder is missing, rather than throwing what the system said', async () => {
    await assert.rejects(listFolder(path.join(root, 'nope')), (err: unknown) => err instanceof FolderError && err.fault === 'missing');
  });
});

describe('realFolder', () => {
  it('answers the real path of a folder', async () => {
    assert.equal(await realFolder(path.join(root, 'sub', '..', 'sub')), path.join(root, 'sub'));
  });

  it('follows a link in the path to where it really leads, so the rules judge that place', async (t) => {
    if (!links) return t.skip('no symlinks here');
    assert.equal(await realFolder(path.join(root, 'linked-dir')), path.join(outside, 'dir'));
  });

  it('refuses a file and a path that is not there', async () => {
    await assert.rejects(realFolder(path.join(root, 'a.json')), (err: unknown) => err instanceof FolderError && err.fault === 'not-a-folder');
    await assert.rejects(realFolder(path.join(root, 'nope')), (err: unknown) => err instanceof FolderError && err.fault === 'missing');
  });
});

describe('readFolderFile', () => {
  it('reads a file with its hash, size and time', async () => {
    const read = await readFolderFile(root, 'sub/b.csv');
    assert.ok(read.ok);
    assert.equal(Buffer.from(read.bytes).toString('utf8'), 'title,url\nb,https://rows.example/b\n');
    assert.equal(read.sha256, createHash('sha256').update(read.bytes).digest('hex'));
    assert.equal(read.size, read.bytes.length);
  });

  it('does not follow a link out of the folder', async (t) => {
    if (!links) return t.skip('no symlinks here');
    assert.deepEqual(await readFolderFile(root, 'link.json'), { ok: false, why: 'outside' });
    assert.deepEqual(await readFolderFile(root, 'linked-dir/inner.json'), { ok: false, why: 'outside' });
  });

  it('does not leave the folder by a path that climbs out of it', async () => {
    const climbed = path.relative(root, path.join(outside, 'secret.json')).split(path.sep).join('/');
    assert.deepEqual(await readFolderFile(root, climbed), { ok: false, why: 'outside' });
  });

  it('says a file is gone, and never reads one past the size ceiling', async () => {
    assert.deepEqual(await readFolderFile(root, 'nope.json'), { ok: false, why: 'gone' });
    await fs.truncate(path.join(root, 'a.json'), MAX_FILE_BYTES + 1);
    assert.deepEqual(await readFolderFile(root, 'a.json'), { ok: false, why: 'too-large' });
  });
});

describe('the module only reads', () => {
  const source = readFileSync(path.join(__dirname, 'folder-io.ts'), 'utf8');

  it('calls nothing that writes, moves, renames or deletes', () => {
    const writes = source.match(/\b(?:writeFile|appendFile|write|rename|unlink|rm|rmdir|mkdir|mkdtemp|copyFile|cp|truncate|chmod|chown|utimes|symlink|link|createWriteStream)\s*\(/g);
    assert.deepEqual(writes, null);
  });

  it('opens a file for reading only, without following a link', () => {
    const opens = [...source.matchAll(/fs\.open\(([^)]*)\)/g)].map((m) => m[1]);
    assert.deepEqual(opens, ['file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0']);
  });
});
