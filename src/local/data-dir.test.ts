import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA_DIR_ENV, dataDirFor } from './data-dir';

test('each system keeps the data in its own application-data place', () => {
  assert.equal(dataDirFor('darwin', {}, '/Users/jane'), '/Users/jane/Library/Application Support/ApplyPack');
  assert.equal(dataDirFor('linux', {}, '/home/jane'), '/home/jane/.local/share/applypack');
  assert.equal(
    dataDirFor('win32', { APPDATA: 'C:\\Users\\Jane\\AppData\\Roaming' }, 'C:\\Users\\Jane'),
    'C:\\Users\\Jane\\AppData\\Roaming\\ApplyPack',
  );
});

test('the system variables that say where data goes are honoured, with a fallback when unset', () => {
  assert.equal(dataDirFor('linux', { XDG_DATA_HOME: '/data/xdg' }, '/home/jane'), '/data/xdg/applypack');
  assert.equal(dataDirFor('win32', {}, 'C:\\Users\\Jane'), 'C:\\Users\\Jane\\AppData\\Roaming\\ApplyPack');
});

test('APPLYPACK_DATA_DIR moves the folder on every system; a blank one does not', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    assert.equal(dataDirFor(platform, { [DATA_DIR_ENV]: '/mnt/big/applypack' }, '/home/jane'), '/mnt/big/applypack');
  }
  assert.equal(dataDirFor('linux', { [DATA_DIR_ENV]: '  ' }, '/home/jane'), '/home/jane/.local/share/applypack');
});
