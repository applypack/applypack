import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, sleep } from './http';

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
