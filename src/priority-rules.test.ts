import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePriorityRules,
  formatPriorityRulesText,
  parsePriorityRules,
  parsePriorityRulesText,
  ruleMatches,
  type PriorityRule,
} from './priority-rules';

const PHP_REMOTE_US: PriorityRule = {
  label: 'PHP remote-US',
  techsAny: ['php'],
  regionsAny: ['US', 'Remote', 'Worldwide'],
  minFitFloor: 90,
};

const job = (
  overrides: Partial<{ title: string; description: string; location: string }>,
) => ({
  title: '',
  description: '',
  location: '',
  ...overrides,
});

describe('parsePriorityRules', () => {
  it('returns [] for null/undefined', () => {
    assert.deepEqual(parsePriorityRules(null), []);
    assert.deepEqual(parsePriorityRules(undefined), []);
  });

  it('returns [] for malformed input', () => {
    assert.deepEqual(parsePriorityRules('not json'), []);
    assert.deepEqual(parsePriorityRules({ not: 'array' }), []);
    assert.deepEqual(
      parsePriorityRules([{ label: 'x' /* missing fields */ }]),
      [],
    );
  });

  it('parses a valid rules array', () => {
    const out = parsePriorityRules([PHP_REMOTE_US]);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.label, 'PHP remote-US');
    assert.equal(out[0]?.minFitFloor, 90);
  });

  it('drops the whole array if any rule is malformed', () => {
    // We chose strict-array semantics: one bad apple invalidates the
    // payload. Caller can re-save valid rules through the UI to recover.
    const out = parsePriorityRules([
      PHP_REMOTE_US,
      { label: 'bad', techsAny: 'not-array' as unknown as string[] },
    ]);
    assert.deepEqual(out, []);
  });
});

describe('ruleMatches', () => {
  it('matches when tech in title + region in location', () => {
    assert.equal(
      ruleMatches(
        PHP_REMOTE_US,
        job({ title: 'Senior PHP Developer', location: 'Remote (US only)' }),
      ),
      true,
    );
  });

  it('matches when tech only in description', () => {
    assert.equal(
      ruleMatches(
        PHP_REMOTE_US,
        job({
          title: 'Senior Backend Engineer',
          description: 'Working in our Laravel/PHP monolith.',
          location: 'United States — Remote',
        }),
      ),
      true,
    );
  });

  it('rejects when tech is missing', () => {
    assert.equal(
      ruleMatches(
        PHP_REMOTE_US,
        job({ title: 'Senior Rails Engineer', location: 'Remote (US)' }),
      ),
      false,
    );
  });

  it('rejects when region is missing', () => {
    assert.equal(
      ruleMatches(
        PHP_REMOTE_US,
        job({ title: 'PHP Developer', location: 'Berlin, Germany' }),
      ),
      false,
    );
  });

  it('treats empty regionsAny as wildcard', () => {
    const wildcardRule: PriorityRule = {
      ...PHP_REMOTE_US,
      regionsAny: [],
    };
    assert.equal(
      ruleMatches(
        wildcardRule,
        job({ title: 'PHP Engineer', location: 'Berlin' }),
      ),
      true,
    );
  });

  it('rejects rule with empty techsAny (invalid rule)', () => {
    assert.equal(
      ruleMatches(
        { ...PHP_REMOTE_US, techsAny: [] },
        job({ title: 'PHP Developer', location: 'Remote US' }),
      ),
      false,
    );
  });

  it('is case-insensitive', () => {
    assert.equal(
      ruleMatches(
        PHP_REMOTE_US,
        job({ title: 'senior php dev', location: 'remote · us' }),
      ),
      true,
    );
  });
});

describe('evaluatePriorityRules', () => {
  it('returns floor=0 when no rule matches', () => {
    const out = evaluatePriorityRules(
      [PHP_REMOTE_US],
      job({ title: 'Rails dev', location: 'Berlin' }),
    );
    assert.equal(out.applied.length, 0);
    assert.equal(out.fitScoreFloor, 0);
  });

  it('returns the max floor across matched rules', () => {
    const r1: PriorityRule = { ...PHP_REMOTE_US, label: 'a', minFitFloor: 80 };
    const r2: PriorityRule = { ...PHP_REMOTE_US, label: 'b', minFitFloor: 95 };
    const out = evaluatePriorityRules(
      [r1, r2],
      job({ title: 'Senior PHP Engineer', location: 'Remote — US' }),
    );
    assert.equal(out.applied.length, 2);
    assert.equal(out.fitScoreFloor, 95);
  });
});

describe('parsePriorityRulesText', () => {
  it('parses a clean rule line', () => {
    const { rules, errors } = parsePriorityRulesText(
      'PHP remote-US | php | US,Remote,Worldwide | 90',
    );
    assert.deepEqual(errors, []);
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0], {
      label: 'PHP remote-US',
      techsAny: ['php'],
      regionsAny: ['US', 'Remote', 'Worldwide'],
      minFitFloor: 90,
    });
  });

  it('skips blank lines and comments', () => {
    const { rules, errors } = parsePriorityRulesText(
      '# comment\n\nPHP remote-US | php | US | 90\n   \n',
    );
    assert.deepEqual(errors, []);
    assert.equal(rules.length, 1);
  });

  it('reports field-count errors', () => {
    const { rules, errors } = parsePriorityRulesText('only one field');
    assert.equal(rules.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.reason, /4 fields/);
  });

  it('reports out-of-range fit floor', () => {
    const { rules, errors } = parsePriorityRulesText('Bad | php | US | 150');
    assert.equal(rules.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.reason, /0-100/);
  });

  it('reports empty techs', () => {
    const { rules, errors } = parsePriorityRulesText('Empty | | US | 90');
    assert.equal(rules.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.reason, /tech/);
  });

  it('allows empty regions (wildcard)', () => {
    const { rules, errors } = parsePriorityRulesText('Anywhere | php | | 90');
    assert.deepEqual(errors, []);
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0]?.regionsAny, []);
  });

  it('round-trips via formatPriorityRulesText', () => {
    const text = 'PHP remote-US | php | US,Remote | 90';
    const { rules } = parsePriorityRulesText(text);
    assert.equal(formatPriorityRulesText(rules), text);
  });
});
