import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripHtml, sleep, DEFAULT_USER_AGENT, retryAfterMs } from './http';

describe('DEFAULT_USER_AGENT', () => {
  it('carries the package.json major.minor, never a stale hardcode', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    const majorMinor = pkg.version.split('.').slice(0, 2).join('.');
    assert.equal(
      DEFAULT_USER_AGENT,
      `applypack/${majorMinor} (+https://github.com/applypack/applypack)`,
    );
  });
});

describe('stripHtml', () => {
  it('removes simple tags', () => {
    assert.equal(stripHtml('<p>Hello</p>'), 'Hello');
  });

  it('removes nested tags', () => {
    assert.equal(stripHtml('<div><p>Hi <b>there</b></p></div>'), 'Hi there');
  });

  it('strips script blocks entirely', () => {
    const html = 'Before<script>alert("XSS!")</script>After';
    assert.equal(stripHtml(html), 'Before After');
  });

  it('strips style blocks entirely', () => {
    const html = 'Before<style>.x{color:red}</style>After';
    assert.equal(stripHtml(html), 'Before After');
  });

  it('decodes common HTML entities', () => {
    assert.equal(stripHtml('Salt &amp; Pepper'), 'Salt & Pepper');
    assert.equal(stripHtml('5 &lt; 10'), '5 < 10');
    assert.equal(stripHtml('a &gt; b'), 'a > b');
    assert.equal(stripHtml('&quot;hi&quot;'), '"hi"');
    assert.equal(stripHtml('&#39;PHP&#39;'), "'PHP'");
    assert.equal(stripHtml('a&nbsp;b'), 'a b');
  });

  it('collapses whitespace', () => {
    assert.equal(
      stripHtml('<p>Hello\n\n   <b>world</b>   !</p>'),
      'Hello world !',
    );
  });

  it('handles empty input', () => {
    assert.equal(stripHtml(''), '');
  });

  it('handles input with no HTML at all', () => {
    assert.equal(stripHtml('plain text'), 'plain text');
  });

  it('decodes hex numeric entities like &#x2F; → /', () => {
    assert.equal(stripHtml('https:&#x2F;&#x2F;example.com'), 'https://example.com');
  });

  it('decodes decimal numeric entities like &#39; → \'', () => {
    assert.equal(stripHtml('it&#39;s great'), "it's great");
  });

  it('decodes mix of named + numeric entities', () => {
    assert.equal(
      stripHtml('Salt &amp; Pepper, &#x27;tasty&#x27; &lt;3'),
      "Salt & Pepper, 'tasty' <3",
    );
  });

  it('decodes &apos; (XML-style apostrophe)', () => {
    assert.equal(stripHtml('it&apos;s ok'), "it's ok");
  });

  // --- structure preservation (paragraphs, bullets, line breaks) ---

  it('turns block tags into paragraph breaks', () => {
    assert.equal(
      stripHtml('<h3>About</h3><p>First.</p><p>Second.</p>'),
      'About\n\nFirst.\n\nSecond.',
    );
  });

  it('renders list items as bullet lines', () => {
    assert.equal(
      stripHtml('<p>Stack:</p><ul><li>Go</li><li>Kubernetes</li></ul><p>Done.</p>'),
      'Stack:\n\n• Go\n• Kubernetes\n\nDone.',
    );
  });

  it('turns <br> into a single line break', () => {
    assert.equal(stripHtml('line one<br>line two<br/>line three'), 'line one\nline two\nline three');
  });

  it('treats source newlines as whitespace, not structure', () => {
    // Hard-wrapped HTML source must not produce fake mid-sentence breaks.
    assert.equal(stripHtml('<p>wrapped\nacross\nlines</p>'), 'wrapped across lines');
  });

  it('caps consecutive blank lines at one empty line', () => {
    assert.equal(stripHtml('<div><p>a</p></div><div><p>b</p></div>'), 'a\n\nb');
  });

  // --- escaped feeds (Greenhouse ships the body HTML-escaped) ---

  it('restores structure from an HTML-escaped body', () => {
    const escaped =
      '&lt;div class="content-intro"&gt;&lt;h3&gt;&lt;strong&gt;Who We Are&lt;/strong&gt;&lt;/h3&gt; &lt;p&gt;Verkada is transforming.&lt;/p&gt;&lt;/div&gt;';
    assert.equal(stripHtml(escaped), 'Who We Are\n\nVerkada is transforming.');
  });

  it('does not double-decode &amp;lt;', () => {
    assert.equal(stripHtml('a &amp;lt;b&amp;gt; c'), 'a &lt;b&gt; c');
  });

  it('keeps loose < and > comparisons in prose', () => {
    assert.equal(
      stripHtml('we <3 offsites, salary > 100k and load < 5ms'),
      'we <3 offsites, salary > 100k and load < 5ms',
    );
  });

  it('drops HTML comments', () => {
    assert.equal(stripHtml('a<!-- hidden note -->b'), 'a b');
  });

  it('ignores out-of-range numeric entities instead of throwing', () => {
    assert.equal(stripHtml('ok &#x110000; still ok'), 'ok still ok');
  });
});

describe('stripHtml — markup declarations', () => {
  it('drops the doctype instead of leaking it into the prose', () => {
    assert.equal(stripHtml('<!DOCTYPE html><html><body><p>Careers</p></body></html>'), 'Careers');
    assert.equal(stripHtml('<!doctype html>\n<p>Careers</p>'), 'Careers');
  });

  it('still leaves prose that merely contains a "<"', () => {
    assert.equal(stripHtml('<p>salary &lt; 100k</p>'), 'salary < 100k');
  });
});

describe('stripHtml — markup nobody closed', () => {
  // A posting is text from outside. Each of these took seconds at this size
  // while every opener scanned to the end of the text on its own; a bound far
  // above what one pass costs still catches that coming back.
  const hostile: Record<string, string> = {
    'comments never closed': `<p>${'<!--'.repeat(80_000)}`,
    'tags never closed': '<a '.repeat(100_000),
    'block tags never closed': '<p '.repeat(100_000),
    'list items never closed': '<li '.repeat(100_000),
    'declarations never closed': '<!x'.repeat(100_000),
    'script openers before one closer': `${'<script '.repeat(50_000)}</script>`,
    'style openers before one closer': `${'<style '.repeat(50_000)}</style>`,
    'style blocks never closed': '<style>'.repeat(50_000),
  };
  for (const [name, text] of Object.entries(hostile)) {
    it(`reads ${name} in one pass`, () => {
      const started = Date.now();
      stripHtml(text);
      const took = Date.now() - started;
      assert.ok(took < 1_500, `${text.length} characters took ${took} ms`);
    });
  }

  it('leaves an opener with no closer as the text it is', () => {
    assert.equal(stripHtml('before <script after'), 'before <script after');
    assert.equal(stripHtml('a <!-- b'), 'a <!-- b');
    assert.equal(stripHtml('x <style>y'), 'x y');
  });

  it('removes a script block from its opener to the first closer after it, whatever the case', () => {
    assert.equal(stripHtml('a<SCRIPT type="x">1</Script>b<script>2</script>c'), 'a b c');
    assert.equal(stripHtml('a<script><script>1</script>b</script>c'), 'a b c');
  });
});

describe('decoded entities are characters a database can hold', () => {
  it('drops a NUL and half a surrogate pair, written either way', () => {
    assert.equal(stripHtml('a&#0;b&#x0;c'), 'abc');
    assert.equal(stripHtml('a&#xD800;b&#57343;c'), 'abc');
    assert.equal(stripHtml('ok &#x1F600; ok'), 'ok \u{1F600} ok');
  });
});

describe('sleep', () => {
  it('resolves after roughly the requested time', async () => {
    const before = Date.now();
    await sleep(50);
    const elapsed = Date.now() - before;
    assert.ok(elapsed >= 45, `expected >=45ms, got ${elapsed}`);
    assert.ok(elapsed < 200, `expected <200ms, got ${elapsed}`);
  });
});

describe('retryAfterMs', () => {
  it('reads seconds or a date, and nothing else', () => {
    const now = Date.parse('Mon, 28 Sep 2026 07:00:00 GMT');
    assert.equal(retryAfterMs('5', now), 5_000);
    assert.equal(retryAfterMs(' 0 ', now), 0);
    assert.equal(retryAfterMs('Mon, 28 Sep 2026 07:00:03 GMT', now), 3_000);
    assert.equal(retryAfterMs('Mon, 28 Sep 2026 06:59:00 GMT', now), 0);
    assert.equal(retryAfterMs('soon', now), null);
    assert.equal(retryAfterMs(null, now), null);
  });
});
