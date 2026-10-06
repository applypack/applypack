import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hardcodedText, marked } from './pseudo';
import { PSEUDO_LOCALE, withLocale } from './locale';

describe('marked', () => {
  it('leaves text alone in a real language', () => {
    assert.equal(marked('Sep 25'), 'Sep 25');
    assert.equal(withLocale('uk', () => marked('25 вер.')), '25 вер.');
    assert.equal(withLocale(PSEUDO_LOCALE, () => marked('Sep 25')), '⟦Sep 25⟧');
  });
});

describe('hardcodedText', () => {
  it('finds the words outside the brackets, and nothing inside them', () => {
    assert.deepEqual(hardcodedText('<h1>⟦Jobs⟧</h1><p>Saved changes reach the worker.</p>'), ['Saved changes reach the worker.']);
    assert.deepEqual(hardcodedText('<p>⟦Checked ⟦Sep 25⟧ by ⟦3 searches⟧⟧</p>'), []);
  });

  it('reads a sentence as one run across its inline elements, and a block as its end', () => {
    assert.deepEqual(hardcodedText('<p>Read <a href="/x">the <b>guide</b></a> first.</p><div>Then <span>this</span></div>'), [
      'Read the guide first.',
      'Then',
      'this',
    ]);
  });

  it('follows a bracket across elements: a rich message is one marked run', () => {
    assert.deepEqual(hardcodedText('<p>⟦Fix it in <a href="/c">the catalog files</a>.⟧ Then tell us.</p>'), ['Then tell us.']);
  });

  it('reads the attributes a person reads or hears', () => {
    assert.deepEqual(hardcodedText('<input placeholder="Search jobs" title="⟦Search⟧" value="node" /><img alt="Logo" src="/x.png"><a aria-label="Remove filter: ⟦Remote⟧">x</a>'), [
      'Search jobs',
      'Logo',
      'Remove filter:',
    ]);
  });

  it('skips what is not the interface: scripts, styles, code, drawings, typed text, comments', () => {
    const html = [
      '<!-- THESIS: a console read twice a day -->',
      '<style>.app { color: red }</style>',
      '<script>if (a < b) { document.title = "</div>Loading"; }</script>',
      '<svg><title>Chart</title><path d="M0 0"/></svg>',
      '<p>⟦Run⟧ <code>npm start</code></p><pre>docker compose up</pre>',
      '<textarea name="notes">Remote only, please</textarea>',
    ].join('');
    assert.deepEqual(hardcodedText(html), []);
  });

  it('skips data that says it is data, attributes included', () => {
    assert.deepEqual(hardcodedText('<td translate="no" title="Senior Backend Engineer"><b>Senior Backend Engineer</b></td><td>Remote</td>'), ['Remote']);
    assert.deepEqual(hardcodedText('<div lang="en"><p>Primary stack 2/2: strong match.</p></div><p lang="uk">Вакансії</p>'), []);
  });

  it('does not take a number, a symbol or a lone letter for a word', () => {
    assert.deepEqual(hardcodedText('<td>72</td><td>—</td><td>v 2.46.0</td><td>5 · 3</td><td>&amp;</td>'), []);
    assert.deepEqual(hardcodedText('<td>5 of 12</td><td>Tom &amp; Jerry&#39;s</td>'), ['5 of 12', "Tom & Jerry's"]);
  });

  it('is not confused by a void element or a self-closed one', () => {
    assert.deepEqual(hardcodedText('<div translate="no"><br><input name="q"><img src="/a.png"/>Acme</div><p>After</p>'), ['After']);
  });
});
