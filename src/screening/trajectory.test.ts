import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trajectoryLine, trajectoryOf } from './trajectory';
import type { ScreenRole } from './prompts';

const NOW = new Date('2026-09-09T00:00:00Z');
const role = (over: Partial<ScreenRole>): ScreenRole => ({ position: 'x', employer: null, start: null, end: null, relevant: true, why: '', sector: null, companyType: null, ...over });

test('trajectoryOf reads the career off the dated roles', () => {
  const t = trajectoryOf(
    [
      role({ position: 'Senior QA', employer: 'SoftServe', start: 'Mar 2021', end: 'Present', sector: 'IT outsourcing', companyType: 'consultancy' }),
      role({ position: 'QA', employer: 'EPAM', start: '2017', end: '2021', sector: 'banking', companyType: 'consultancy' }),
      role({ position: 'Manual QA', employer: 'Ciklum', start: '2016', end: '2017', relevant: false, sector: 'e-commerce', companyType: 'agency' }),
      role({ position: 'Undated', employer: 'Nowhere' }),
    ],
    NOW,
  );
  assert.equal(t.roles, 3, 'undated roles do not count');
  assert.equal(t.employers, 4, 'employers are counted by name, dated or not');
  assert.equal(t.yearsTotal, 10.8);
  assert.equal(t.yearsRelevant, 9.8);
  assert.equal(t.averageTenure, 4.2);
  assert.equal(t.inRoleNow, true);
  assert.deepEqual(t.sectors, ['IT outsourcing', 'banking', 'e-commerce']);
  assert.deepEqual(t.companyTypes, ['consultancy', 'agency']);
  assert.equal(trajectoryLine(t), '10.8 years across 4 employers · average stay 4.2 years · in a role now · IT outsourcing, banking, e-commerce');
});

test('trajectoryOf with nothing dated', () => {
  const t = trajectoryOf([role({ position: 'x', employer: 'Y' })], NOW);
  assert.deepEqual([t.roles, t.yearsTotal, t.averageTenure, t.inRoleNow], [0, null, null, false]);
  assert.equal(trajectoryLine(t), 'no dated roles in the text');
});
