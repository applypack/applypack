import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { folderAllowed, folderPathFrom, inboxRoots, insideFolder, type FolderRules } from './folder-path';

const posix = path.posix;
const win = path.win32;
const local: FolderRules = { launcher: true, home: '/Users/sam', dataDir: '/Users/sam/Library/Application Support/ApplyPack', roots: [] };
const server: FolderRules = { launcher: false, home: '/home/node', dataDir: '/data', roots: ['/inbox'] };
const allowed = (folder: string, rules: FolderRules, p = posix): boolean => folderAllowed(folder, rules, p).ok;
const reason = (folder: string, rules: FolderRules): string => {
  const verdict = folderAllowed(folder, rules, posix);
  return verdict.ok ? '' : verdict.reason;
};

describe('folderAllowed on a local install', () => {
  it('reads a folder inside the home directory, however deep', () => {
    assert.equal(allowed('/Users/sam/ApplyPack/inbox', local), true);
    assert.equal(allowed('/Users/sam/jobs', local), true);
    assert.equal(allowed('/Users/sam/Documents/job hunt/exports', local), true);
  });

  it('refuses the home directory itself and anything outside it', () => {
    assert.equal(allowed('/Users/sam', local), false);
    assert.equal(allowed('/Users/alex/jobs', local), false);
    assert.equal(allowed('/etc', local), false);
    assert.equal(allowed('/', local), false);
    // A sibling whose name only starts the same way is not inside.
    assert.equal(allowed('/Users/sammy/jobs', local), false);
    assert.match(reason('/etc', local), /inside your home folder/);
  });

  it('refuses a hidden folder at any depth', () => {
    assert.equal(allowed('/Users/sam/.ssh', local), false);
    assert.equal(allowed('/Users/sam/.config/tool/out', local), false);
    assert.equal(allowed('/Users/sam/jobs/.cache', local), false);
    assert.match(reason('/Users/sam/.ssh', local), /hidden folder/);
  });

  it('refuses the system’s own folders under home, whatever their case', () => {
    assert.equal(allowed('/Users/sam/Library/Mail', local), false);
    assert.equal(allowed('/Users/sam/library', local), false);
    assert.equal(allowed('C:\\Users\\sam\\AppData\\Roaming\\tool', { ...local, home: 'C:\\Users\\sam', dataDir: 'C:\\Users\\sam\\AppData\\Roaming\\ApplyPack' }, win), false);
    // Only at the top of home: a folder a person named "Library" further down is theirs.
    assert.equal(allowed('/Users/sam/Documents/Library', local), true);
  });

  it('refuses the data folder, a folder inside it and a folder that holds it', () => {
    const moved: FolderRules = { ...local, dataDir: '/Users/sam/apps/applypack-data' };
    assert.equal(allowed('/Users/sam/apps/applypack-data', moved), false);
    assert.equal(allowed('/Users/sam/apps/applypack-data/snapshots', moved), false);
    assert.equal(allowed('/Users/sam/apps', moved), false);
    assert.equal(allowed('/Users/sam/apps-other', moved), true);
    assert.match(reason('/Users/sam/apps', moved), /its own database/);
  });

  it('reads a named root outside home as well', () => {
    const withRoot: FolderRules = { ...local, roots: ['/Volumes/disk/jobs'] };
    assert.equal(allowed('/Volumes/disk/jobs', withRoot), true);
    assert.equal(allowed('/Volumes/disk/jobs/2026', withRoot), true);
    assert.equal(allowed('/Volumes/disk', withRoot), false);
  });

  it('reads Windows paths by Windows rules', () => {
    const rules: FolderRules = { launcher: true, home: 'C:\\Users\\sam', dataDir: 'C:\\Users\\sam\\AppData\\Roaming\\ApplyPack', roots: [] };
    assert.equal(allowed('C:\\Users\\sam\\ApplyPack\\inbox', rules, win), true);
    assert.equal(allowed('D:\\exports', rules, win), false);
    assert.equal(allowed('C:\\Users\\sam\\.tool', rules, win), false);
  });
});

describe('folderAllowed with a home at the root of the disk', () => {
  it('reads nothing under the launcher, since such a home bounds nothing', () => {
    const rootHome: FolderRules = { ...local, home: '/', dataDir: '/data' };
    assert.equal(allowed('/etc', rootHome), false);
    assert.equal(allowed('/srv/jobs', rootHome), false);
    assert.equal(allowed('C:\\jobs', { ...local, home: 'C:\\', dataDir: 'C:\\data' }, win), false);
    // A root named in the setting is still read.
    assert.equal(allowed('/inbox/run', { ...rootHome, roots: ['/inbox'] }), true);
  });
});

describe('folderAllowed on a server', () => {
  it('reads only a named root and what lies beneath it', () => {
    assert.equal(allowed('/inbox', server), true);
    assert.equal(allowed('/inbox/tool-a', server), true);
    assert.equal(allowed('/home/node/jobs', server), false);
    assert.equal(allowed('/inbox-other', server), false);
    assert.equal(allowed('/', server), false);
    assert.match(reason('/home/node/jobs', server), /not inside a folder named in APPLYPACK_INBOX_ROOTS/);
  });

  it('reads nothing when no root is named, and says who can change that', () => {
    const none: FolderRules = { ...server, roots: [] };
    assert.equal(allowed('/inbox', none), false);
    assert.match(reason('/inbox', none), /none is named\. Whoever runs this install/);
  });
});

describe('insideFolder', () => {
  it('holds for a file beneath the folder and for nothing else', () => {
    assert.equal(insideFolder('/inbox', '/inbox/a.json', posix), true);
    assert.equal(insideFolder('/inbox', '/inbox/2026/a.json', posix), true);
    assert.equal(insideFolder('/inbox', '/inbox', posix), false);
    assert.equal(insideFolder('/inbox', '/inbox-other/a.json', posix), false);
    assert.equal(insideFolder('/inbox', '/etc/passwd', posix), false);
    assert.equal(insideFolder('C:\\inbox', 'D:\\inbox\\a.json', win), false);
  });
});

describe('folderPathFrom', () => {
  it('reads what a person types: quotes, a trailing slash, dots, the home sign', () => {
    assert.equal(folderPathFrom('  /Users/sam/jobs/  ', '/Users/sam', posix), '/Users/sam/jobs');
    assert.equal(folderPathFrom('"/Users/sam/job hunt"', '/Users/sam', posix), '/Users/sam/job hunt');
    assert.equal(folderPathFrom('/Users/sam/jobs/../exports/.', '/Users/sam', posix), '/Users/sam/exports');
    assert.equal(folderPathFrom('~/ApplyPack/inbox', '/Users/sam', posix), '/Users/sam/ApplyPack/inbox');
    assert.equal(folderPathFrom('~', '/Users/sam', posix), '/Users/sam');
    assert.equal(folderPathFrom('C:\\Users\\sam\\jobs\\', 'C:\\Users\\sam', win), 'C:\\Users\\sam\\jobs');
  });

  it('refuses a path that is not absolute: it would mean two folders in two processes', () => {
    assert.equal(folderPathFrom('jobs/exports', '/Users/sam', posix), null);
    assert.equal(folderPathFrom('./jobs', '/Users/sam', posix), null);
    assert.equal(folderPathFrom('', '/Users/sam', posix), null);
    assert.equal(folderPathFrom('   ', '/Users/sam', posix), null);
    // Another user's home is not spelled out for anyone.
    assert.equal(folderPathFrom('~alex/jobs', '/Users/sam', posix), null);
    // A NUL names no path, and the system's answer to one is not a folder's.
    assert.equal(folderPathFrom('/Users/sam/jobs\0/etc', '/Users/sam', posix), null);
  });
});

describe('inboxRoots', () => {
  it('splits like PATH and keeps absolute paths only', () => {
    assert.deepEqual(inboxRoots('/inbox: /mnt/jobs/ ::relative/path', posix), ['/inbox', '/mnt/jobs']);
    assert.deepEqual(inboxRoots('C:\\inbox;D:\\jobs', win), ['C:\\inbox', 'D:\\jobs']);
    assert.deepEqual(inboxRoots(undefined, posix), []);
    assert.deepEqual(inboxRoots('', posix), []);
  });
});
