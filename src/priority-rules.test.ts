import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPriorityFloor,
  evaluatePriorityRules,
  formatPriorityRulesText,
  parsePriorityRules,
  parsePriorityRulesText,
  ruleMatches,
  type PriorityRule,
} from './priority-rules';
import type { ClaudeClassification } from './types';

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

  describe('boundary correctness — bugs we found in real data', () => {
    it('does NOT match "Remote · Germany" when regionsAny=["Remote US"]', () => {
      // Regression: bare "Remote" as a region used to match every
      // remote-Europe job. Multi-token "Remote US" requires both words
      // (in any position) so Germany-remote no longer slips through.
      const rule: PriorityRule = {
        ...PHP_REMOTE_US,
        regionsAny: ['Remote US', 'United States', 'Worldwide'],
      };
      assert.equal(
        ruleMatches(
          rule,
          job({ title: 'Senior PHP Developer', location: 'Remote · Germany' }),
        ),
        false,
      );
    });

    it('matches "Dallas, TX (Remote US or Hybrid)" with regionsAny=["Remote US"]', () => {
      const rule: PriorityRule = {
        ...PHP_REMOTE_US,
        regionsAny: ['Remote US'],
      };
      assert.equal(
        ruleMatches(
          rule,
          job({
            title: 'Senior PHP Developer',
            location: 'Dallas, TX (Remote US or Hybrid)',
          }),
        ),
        true,
      );
    });

    it('matches "REMOTE (US)" with regionsAny=["Remote US"]', () => {
      const rule: PriorityRule = {
        ...PHP_REMOTE_US,
        regionsAny: ['Remote US'],
      };
      assert.equal(
        ruleMatches(
          rule,
          job({ title: 'PHP Engineer', location: 'REMOTE (US)' }),
        ),
        true,
      );
    });

    it('does NOT match "Russia" or "BUS" when regionsAny=["US"]', () => {
      const rule: PriorityRule = { ...PHP_REMOTE_US, regionsAny: ['US'] };
      assert.equal(
        ruleMatches(
          rule,
          job({ title: 'Senior PHP', location: 'Moscow, Russia' }),
        ),
        false,
      );
      assert.equal(
        ruleMatches(rule, job({ title: 'Senior PHP', location: 'BUS depot' })),
        false,
      );
    });

    it('does match "USA" when regionsAny=["US"] (intended behaviour)', () => {
      // "us" at start-of-string is a valid word boundary; trailing "a"
      // is allowed. Catches "USA", "US-only", "US/EU".
      const rule: PriorityRule = { ...PHP_REMOTE_US, regionsAny: ['US'] };
      assert.equal(
        ruleMatches(rule, job({ title: 'Senior PHP', location: 'USA' })),
        true,
      );
    });

    it('does NOT match "graphql" when techsAny=["php"]', () => {
      const rule: PriorityRule = { ...PHP_REMOTE_US, techsAny: ['php'] };
      assert.equal(
        ruleMatches(
          rule,
          job({
            title: 'Senior GraphQL Engineer',
            description: 'GraphQL APIs only.',
            location: 'Remote US',
          }),
        ),
        false,
      );
    });

    it('matches "PHP-FPM" / "PHPunit" when techsAny=["php"]', () => {
      const rule: PriorityRule = { ...PHP_REMOTE_US, techsAny: ['php'] };
      assert.equal(
        ruleMatches(
          rule,
          job({
            title: 'Backend Engineer',
            description: 'PHP-FPM tuning, PHPunit tests.',
            location: 'Remote US',
          }),
        ),
        true,
      );
    });

    it('multi-token tech phrase "node js" requires both words present', () => {
      const rule: PriorityRule = {
        ...PHP_REMOTE_US,
        techsAny: ['node js'],
      };
      assert.equal(
        ruleMatches(
          rule,
          job({
            title: 'Senior Node.js Engineer',
            description: 'Node JS / TypeScript.',
            location: 'Remote US',
          }),
        ),
        true,
      );
      // "Node API" alone doesn't match — missing "js".
      assert.equal(
        ruleMatches(
          rule,
          job({
            title: 'Senior Node Engineer',
            description: 'Pure Node API service.',
            location: 'Remote US',
          }),
        ),
        false,
      );
    });
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

describe('applyPriorityFloor', () => {
  const baseClassification = (
    overrides: Partial<ClaudeClassification> = {},
  ): ClaudeClassification => ({
    fit_score: 50,
    location_match: false,
    salary_min_usd: null,
    salary_max_usd: null,
    tech_match: ['php'],
    red_flags: [],
    summary: 'Bare-bones PHP backend role.',
    ...overrides,
  });

  it('returns the input unchanged + empty applied[] when no rule matches', () => {
    const c = baseClassification();
    const out = applyPriorityFloor(
      c,
      [PHP_REMOTE_US],
      job({ title: 'Rails dev', location: 'Berlin' }),
    );
    assert.equal(out.applied.length, 0);
    assert.strictEqual(out.classification, c); // identity check — no clone when nothing changed
  });

  it('clamps fit_score UP to the rule floor when matched', () => {
    const c = baseClassification({ fit_score: 50 });
    const out = applyPriorityFloor(
      c,
      [PHP_REMOTE_US],
      job({ title: 'Senior PHP Engineer', location: 'Remote — US' }),
    );
    assert.equal(out.applied.length, 1);
    assert.equal(out.classification.fit_score, 90);
  });

  it('does NOT lower fit_score when Claude already scored above the floor', () => {
    const c = baseClassification({ fit_score: 95 });
    const out = applyPriorityFloor(
      c,
      [PHP_REMOTE_US],
      job({ title: 'Senior PHP Engineer', location: 'Remote — US' }),
    );
    assert.equal(out.classification.fit_score, 95);
  });

  it('forces location_match=true even if Claude said false', () => {
    const c = baseClassification({ location_match: false });
    const out = applyPriorityFloor(
      c,
      [PHP_REMOTE_US],
      job({ title: 'Senior PHP Engineer', location: 'Remote — US' }),
    );
    assert.equal(out.classification.location_match, true);
  });

  it('does NOT touch salary fields (salary remains a hard floor for dismissal)', () => {
    const c = baseClassification({ salary_min_usd: 40_000, salary_max_usd: 60_000 });
    const out = applyPriorityFloor(
      c,
      [PHP_REMOTE_US],
      job({ title: 'Senior PHP Engineer', location: 'Remote — US' }),
    );
    assert.equal(out.classification.salary_min_usd, 40_000);
    assert.equal(out.classification.salary_max_usd, 60_000);
  });

  it('preserves tech_match / red_flags / summary verbatim', () => {
    const c = baseClassification({
      tech_match: ['php'],
      red_flags: ['no salary'],
      summary: 'Vague PHP role.',
    });
    const out = applyPriorityFloor(
      c,
      [PHP_REMOTE_US],
      job({ title: 'Senior PHP Engineer', location: 'Remote — US' }),
    );
    assert.deepEqual(out.classification.tech_match, ['php']);
    assert.deepEqual(out.classification.red_flags, ['no salary']);
    assert.equal(out.classification.summary, 'Vague PHP role.');
  });

  it('returns a *copy* (does not mutate the input classification)', () => {
    const c = baseClassification({ fit_score: 50, location_match: false });
    applyPriorityFloor(
      c,
      [PHP_REMOTE_US],
      job({ title: 'Senior PHP Engineer', location: 'Remote — US' }),
    );
    assert.equal(c.fit_score, 50);
    assert.equal(c.location_match, false);
  });

  it('reports all matched rules in applied[]', () => {
    const r1: PriorityRule = { ...PHP_REMOTE_US, label: 'first', minFitFloor: 80 };
    const r2: PriorityRule = { ...PHP_REMOTE_US, label: 'second', minFitFloor: 95 };
    const out = applyPriorityFloor(
      baseClassification({ fit_score: 60 }),
      [r1, r2],
      job({ title: 'Senior PHP Engineer', location: 'Remote — US' }),
    );
    assert.equal(out.applied.length, 2);
    assert.deepEqual(
      out.applied.map((r) => r.label),
      ['first', 'second'],
    );
    assert.equal(out.classification.fit_score, 95); // max floor wins
  });

  it('handles an empty rules array gracefully', () => {
    const c = baseClassification();
    const out = applyPriorityFloor(
      c,
      [],
      job({ title: 'Senior PHP Engineer', location: 'Remote — US' }),
    );
    assert.equal(out.applied.length, 0);
    assert.strictEqual(out.classification, c);
  });
});
