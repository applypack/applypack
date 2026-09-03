import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { insideParens, parseDouTitle } from './dou-title';

// Titles recorded from the PHP feed on 2026-09-03.
describe('parseDouTitle', () => {
  it('splits role, company and the markers', () => {
    assert.deepEqual(parseDouTitle('Backend Engineer Core Team (Go + PHP) в BetterMe, Київ, за кордоном, віддалено'), {
      title: 'Backend Engineer Core Team (Go + PHP)',
      company: 'BetterMe',
      salary: null,
      places: ['Київ'],
      remote: true,
      abroad: true,
    });
  });

  it('keeps a comma inside the company name', () => {
    const t = parseDouTitle('PHP Team Lead в Stape, Inc, за кордоном, віддалено');
    assert.equal(t.company, 'Stape, Inc');
    assert.deepEqual(t.places, []);
    assert.ok(t.remote && t.abroad);
  });

  it('reads the salary and a foreign city with its country in parentheses', () => {
    assert.deepEqual(parseDouTitle('Senior Full-Stack Developer (PHP / Go / Vue.js) в Starlight Media, $2000–2500, віддалено'), {
      title: 'Senior Full-Stack Developer (PHP / Go / Vue.js)',
      company: 'Starlight Media',
      salary: '$2000–2500',
      places: [],
      remote: true,
      abroad: false,
    });
    const lisbon = parseDouTitle('fullstack engineer (php + angular) в meetFrankie, Лісабон (Португалія), віддалено');
    assert.equal(lisbon.company, 'meetFrankie');
    assert.deepEqual(lisbon.places, ['Лісабон (Португалія)']);
  });

  it('a Cyrillic city the gazetteer lacks is still a place; a Latin tail is the company', () => {
    assert.deepEqual(parseDouTitle('Middle+ PHP Developer (with DevOps) в SendPulse, Чернігів, віддалено').places, ['Чернігів']);
    assert.equal(parseDouTitle('Developer в Acme, LLC').company, 'Acme, LLC');
  });

  it('an office-only posting is not remote', () => {
    const t = parseDouTitle('Senior PHP Yii2 Developer в iPOST, Київ');
    assert.deepEqual([t.remote, t.abroad, t.places, t.company], [false, false, ['Київ'], 'iPOST']);
  });

  it('a title without " в " is just a title', () => {
    assert.deepEqual(parseDouTitle('  PHP  Developer '), { title: 'PHP Developer', company: null, salary: null, places: [], remote: false, abroad: false });
  });

  it('insideParens', () => {
    assert.equal(insideParens('Лісабон (Португалія)'), 'Португалія');
    assert.equal(insideParens('Київ'), '');
  });
});
