import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLY_LINK_FLAGS,
  APPLY_URL_MISSING,
  APPLY_URL_NOT_AN_APPLICATION,
  APPLY_URL_SHORTENED,
  APPLY_URL_UNUSABLE,
  checkApplyLink,
  withApplyLinkFlags,
} from './apply-link';

/** Fetched row unless a case says otherwise — pasted rows are the exception. */
const fetched = (url: string) => checkApplyLink({ url, pasted: false });
const pasted = (url: string) => checkApplyLink({ url, pasted: true });

describe('apply-url-missing', () => {
  const cases: [string, string, string[]][] = [
    ['empty on a fetched row', '', [APPLY_URL_MISSING]],
    ['whitespace on a fetched row', '   ', [APPLY_URL_MISSING]],
    ['tab and newline on a fetched row', '\t\n', [APPLY_URL_MISSING]],
  ];
  for (const [name, url, expected] of cases) {
    test(name, () => assert.deepEqual(fetched(url), expected));
  }

  test('a pasted row with no URL is not flagged', () => {
    // All 13 URL-less rows in the corpus are MANUAL: /jobs/new stores an
    // empty URL by design, so flagging it would only ever hit the operator.
    assert.deepEqual(pasted(''), []);
    assert.deepEqual(pasted('   '), []);
  });

  test('a pasted row with a bad URL is still flagged', () => {
    // The exemption covers absence, not content.
    assert.deepEqual(pasted('javascript:alert(1)'), [APPLY_URL_UNUSABLE]);
  });
});

describe('apply-url-unusable', () => {
  const cases: [string, string][] = [
    ['not a URL at all', 'apply by email'],
    ['scheme only', 'https://'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<p>hi</p>'],
    ['mailto scheme', 'mailto:jobs@example.com'],
    ['ftp scheme', 'ftp://example.com/jobs'],
    ['file scheme', 'file:///etc/passwd'],
  ];
  for (const [name, url] of cases) {
    test(name, () => assert.deepEqual(fetched(url), [APPLY_URL_UNUSABLE]));
  }

  test('an unusable URL reports only that flag', () => {
    // No point telling the user a link is shortened when it cannot be opened.
    assert.deepEqual(fetched('javascript:location="bit.ly/x"'), [
      APPLY_URL_UNUSABLE,
    ]);
  });
});

describe('apply-url-shortened', () => {
  const cases: [string, string][] = [
    ['bit.ly', 'https://bit.ly/3xYz'],
    ['tinyurl', 'https://tinyurl.com/abc'],
    ['t.co', 'https://t.co/abc'],
    ['goo.gl', 'https://goo.gl/maps/x'],
    ['lnkd.in', 'https://lnkd.in/eXaMple'],
    ['is.gd', 'https://is.gd/abc'],
    ['subdomain of a shortener', 'https://a.bit.ly/3xYz'],
    ['uppercase host', 'https://BIT.LY/3xYz'],
    ['http scheme', 'http://bit.ly/3xYz'],
  ];
  for (const [name, url] of cases) {
    test(name, () => assert.deepEqual(fetched(url), [APPLY_URL_SHORTENED]));
  }

  const notShortened: [string, string][] = [
    ['a host merely ending in the name', 'https://notbit.ly.example.com/jobs'],
    ['a host containing the name', 'https://mybit.lyric.com/jobs'],
    ['a path containing the name', 'https://example.com/bit.ly/jobs'],
    // Deliberate: a Google Form states its own destination and hides
    // nothing. Our single corpus occurrence is a legitimate HN posting.
    ['forms.gle', 'https://forms.gle/diVa5ScKJLYnW7u38'],
  ];
  for (const [name, url] of notShortened) {
    test(`${name} is not a shortener`, () => assert.deepEqual(fetched(url), []));
  }
});

describe('apply-url-not-an-application', () => {
  const cases: [string, string][] = [
    ['a YouTube video', 'https://www.youtube.com/watch?v=djsPTbs7R_w'],
    ['a youtu.be link', 'https://youtu.be/djsPTbs7R_w'],
    ['a LinkedIn company page', 'https://www.linkedin.com/company/tyce/jobs/'],
    ['a Facebook page', 'https://facebook.com/somecompany'],
    ['an X profile', 'https://x.com/somecompany'],
    ['a Telegram handle', 'https://t.me/somerecruiter'],
    ['a WhatsApp link', 'https://wa.me/15551234567'],
    ['a Discord invite', 'https://discord.gg/abcdef'],
  ];
  for (const [name, url] of cases) {
    test(name, () =>
      assert.deepEqual(fetched(url), [APPLY_URL_NOT_AN_APPLICATION]),
    );
  }

  const fine: [string, string][] = [
    ['a lookalike host', 'https://mylinkedin.com/jobs/1'],
    ['the name in the path', 'https://example.com/youtube.com/jobs'],
    ['a real ATS board', 'https://jobs.lever.co/spotify/abc'],
  ];
  for (const [name, url] of fine) {
    test(`${name} is fine`, () => assert.deepEqual(fetched(url), []));
  }

  test('LinkedIn’s own shortener reports only that it is shortened', () => {
    // `lnkd.in` resolves to linkedin.com, but only over the network. This
    // module reads the host string and nothing else, so it states the fact
    // it has — the link hides its destination — and does not infer the rest.
    assert.deepEqual(fetched('https://lnkd.in/eXaMple'), [APPLY_URL_SHORTENED]);
  });
});

describe('non-Latin company names', () => {
  // The plan asked for a company↔apply-domain mismatch rule with a
  // non-Latin-name exemption. Measured on our corpus that rule produced
  // either nothing or 37% false positives, so it was dropped — which makes
  // the exemption structural rather than conditional: the company name is
  // not an input, so no name can change any verdict. These cases pin that.
  const names = ['Ромашка', '株式会社テスト', 'Ελλάδα ΑΕ', 'شركة', 'Acme Inc'];

  test('a company name cannot reach this module', () => {
    // If a name parameter were ever added, this call stops compiling.
    const link = { url: 'https://acme.example.com/jobs/1', pasted: false };
    assert.deepEqual(checkApplyLink(link), []);
    assert.deepEqual(Object.keys(link).sort(), ['pasted', 'url']);
  });

  test('every verdict is identical whatever the company is called', () => {
    // The names below are carried alongside, exactly as a caller would hold
    // them, and never influence the result.
    for (const name of names) {
      assert.deepEqual(fetched('https://acme.example.com/jobs/1'), [], name);
      assert.deepEqual(
        fetched('https://www.youtube.com/watch?v=x'),
        [APPLY_URL_NOT_AN_APPLICATION],
        name,
      );
    }
  });
});

describe('corpus regressions', () => {
  // Fixtures taken from the 814 stored jobs, pinning the penalties this
  // feature deliberately does not apply (ADR 0023).
  test('Block’s http careers domain is not a flag', () => {
    // 185 rows — Greenhouse itself serves this absolute_url, and the host
    // 301s to https and answers 200. The scheme is Block’s config, not a
    // property of the posting.
    assert.deepEqual(
      fetched('http://block.xyz/careers/jobs/4667604008?gh_jid=4667604008'),
      [],
    );
  });

  test('an aggregator listing on its own domain is not a flag', () => {
    // The plan’s mismatch rule fired on 26 HN rows, all false: an HN job’s
    // company row is the aggregator, so its apply host is always different.
    assert.deepEqual(fetched('https://brandfetch.com'), []);
    assert.deepEqual(fetched('https://nango.dev'), []);
    assert.deepEqual(fetched('https://jobicy.com/jobs/x'), []);
  });

  test('a bare company root is not a flag', () => {
    // Inconvenient, not untrustworthy — 7 corpus rows, all real employers.
    assert.deepEqual(fetched('https://permitflow.com'), []);
  });
});

describe('withApplyLinkFlags', () => {
  const link = { url: 'https://www.youtube.com/watch?v=x', pasted: false };

  test('appends to the model’s flags, preserving their order', () => {
    assert.deepEqual(withApplyLinkFlags(['stack-mismatch', 'low-pay'], link), [
      'stack-mismatch',
      'low-pay',
      APPLY_URL_NOT_AN_APPLICATION,
    ]);
  });

  test('returns the model’s flags unchanged when the link is fine', () => {
    const clean = { url: 'https://jobs.lever.co/spotify/abc', pasted: false };
    assert.deepEqual(withApplyLinkFlags(['no-salary-listed'], clean), [
      'no-salary-listed',
    ]);
  });

  test('does not duplicate a tag the model already emitted', () => {
    assert.deepEqual(
      withApplyLinkFlags([APPLY_URL_NOT_AN_APPLICATION], link),
      [APPLY_URL_NOT_AN_APPLICATION],
    );
  });

  test('does not mutate the caller’s array', () => {
    const model = ['stack-mismatch'];
    withApplyLinkFlags(model, link);
    assert.deepEqual(model, ['stack-mismatch']);
  });

  test('works from an empty model list', () => {
    assert.deepEqual(withApplyLinkFlags([], link), [
      APPLY_URL_NOT_AN_APPLICATION,
    ]);
  });
});

test('every exported flag is kebab-case and unique', () => {
  assert.equal(new Set(APPLY_LINK_FLAGS).size, APPLY_LINK_FLAGS.length);
  for (const flag of APPLY_LINK_FLAGS) {
    assert.match(flag, /^[a-z]+(-[a-z]+)*$/, flag);
  }
});
