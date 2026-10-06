import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageSyntaxError, formatMessage, messageShape, parseMessage, partsToText, type MessageParams } from './message';

const say = (message: string, params: MessageParams = {}, tag = 'en-US'): string => partsToText(formatMessage(parseMessage(message), params, tag));

describe('formatMessage', () => {
  /** message, arguments, language, what it reads as. */
  const CASES: [string, MessageParams, string, string][] = [
    ['Jobs', {}, 'en-US', 'Jobs'],
    ['v{version} is out', { version: '2.46.0' }, 'en-US', 'v2.46.0 is out'],
    ['{a} of {b}', { a: 3, b: 12 }, 'en-US', '3 of 12'],
    // An argument is written as it is; `number` and # take the language's grouping.
    ['{n} read', { n: 12345 }, 'en-US', '12345 read'],
    ['{n, number} read', { n: 12345 }, 'en-US', '12,345 read'],
    ['{n, number} прочитано', { n: 12345.5 }, 'uk-UA-u-nu-latn', '12 345,5 прочитано'],
    ['{n, number}', { n: 1234567 }, 'hi-IN-u-nu-latn', '12,34,567'],
    ['{n, plural, one {# job} other {# jobs}}', { n: 1 }, 'en-US', '1 job'],
    ['{n, plural, one {# job} other {# jobs}}', { n: 0 }, 'en-US', '0 jobs'],
    ['{n, plural, one {# job} other {# jobs}}', { n: 1200 }, 'en-US', '1,200 jobs'],
    ['{n, plural, =0 {no jobs} one {# job} other {# jobs}}', { n: 0 }, 'en-US', 'no jobs'],
    // The four Ukrainian forms: 1, 2–4, 5–20, a fraction.
    ['{n, plural, one {# вакансія} few {# вакансії} many {# вакансій} other {# вакансії}}', { n: 1 }, 'uk-UA', '1 вакансія'],
    ['{n, plural, one {# вакансія} few {# вакансії} many {# вакансій} other {# вакансії}}', { n: 3 }, 'uk-UA', '3 вакансії'],
    ['{n, plural, one {# вакансія} few {# вакансії} many {# вакансій} other {# вакансії}}', { n: 11 }, 'uk-UA', '11 вакансій'],
    ['{n, plural, one {# вакансія} few {# вакансії} many {# вакансій} other {# вакансії}}', { n: 21 }, 'uk-UA', '21 вакансія'],
    ['{n, plural, one {# вакансія} few {# вакансії} many {# вакансій} other {# вакансії}}', { n: 1.5 }, 'uk-UA', '1,5 вакансії'],
    // A category the message has no branch for reads as `other` — an English message under Ukrainian rules.
    ['{n, plural, one {# job} other {# jobs}}', { n: 5 }, 'uk-UA', '5 jobs'],
    ['{kind, select, pdf {a PDF} docx {a Word file} other {a file}}', { kind: 'docx' }, 'en-US', 'a Word file'],
    ['{kind, select, pdf {a PDF} docx {a Word file} other {a file}}', { kind: 'txt' }, 'en-US', 'a file'],
    // Nested: the plural's # survives a select inside it, and arguments work at any depth.
    ['{n, plural, one {{who} has # match} other {{who} has {kind, select, new {# new} other {#}} matches}}', { n: 4, who: 'Search 2', kind: 'new' }, 'en-US', 'Search 2 has 4 new matches'],
    // Apostrophes are plain unless they quote syntax.
    ["don't", {}, 'en-US', "don't"],
    ["l'offre de {company}", { company: 'Acme' }, 'fr-FR', "l'offre de Acme"],
    ["it''s", {}, 'en-US', "it's"],
    ["'{'name'}' stays", {}, 'en-US', '{name} stays'],
    ["'{name}' and {name}", { name: 'x' }, 'en-US', '{name} and x'],
    ["{n, plural, one {'#'# job} other {'#'# jobs}}", { n: 2 }, 'en-US', '#2 jobs'],
    // Outside a plural # is a character, and so is a < that opens no tag.
    ['issue #{n}', { n: 7 }, 'en-US', 'issue #7'],
    ['salary < 100k, fit >= {n}', { n: 70 }, 'en-US', 'salary < 100k, fit >= 70'],
    ["'<b>' is not bold", {}, 'en-US', '<b> is not bold'],
    // As text, an inline element gives its words.
    ['Read <link>the guide</link> first<br/>', {}, 'en-US', 'Read the guide first'],
    // An argument nobody passed stays in sight.
    ['Hello, {name}', {}, 'en-US', 'Hello, {name}'],
  ];
  for (const [message, params, tag, expected] of CASES) {
    it(`${tag}: ${message} → ${expected}`, () => assert.equal(say(message, params, tag).replace(/ | /g, ' '), expected));
  }

  it('keeps an inline element as a part, with what it wraps', () => {
    const parts = formatMessage(parseMessage('Fix it in <link>the <b>{what}</b> files</link>.'), { what: 'catalog' }, 'en-US');
    assert.deepEqual(parts, ['Fix it in ', { tag: 'link', children: ['the ', { tag: 'b', children: ['catalog'] }, ' files'] }, '.']);
  });

  it('joins neighbouring text into one part', () => {
    assert.deepEqual(formatMessage(parseMessage('{a}{b} and {n, plural, one {#} other {#}}'), { a: 'x', b: 'y', n: 2 }, 'en-US'), ['xy and 2']);
  });
});

describe('parseMessage', () => {
  const BROKEN: [string, RegExp][] = [
    ['{n, plural, one {# job}}', /no "other"/],
    ['{kind, select, pdf {x}}', /no "other"/],
    ['{n, plural, several {x} other {y}}', /not a plural category/],
    ['{n, plural, one {x} one {y} other {z}}', /given twice/],
    ['{n, date}', /unknown argument type/],
    ['{name', /expected/],
    ['{}', /argument name/],
    ['closing } alone', /unexpected "}"/],
    ['{n, plural, one {x} other {y}', /expected a selector/],
    ['<link>never closed', /unclosed <link>/],
    ['<a>wrong</b>', /unexpected <\/b>/],
    ['stray </link>', /unexpected <\/link>/],
    ["'{ never closed", /unclosed quote/],
  ];
  for (const [message, reason] of BROKEN) {
    it(`refuses ${message}`, () => assert.throws(() => parseMessage(message), (err) => err instanceof MessageSyntaxError && reason.test(err.message)));
  }
});

describe('messageShape', () => {
  it('lists the arguments, the tags and the branches a message has', () => {
    const shape = messageShape(parseMessage('{who}: <b>{n, plural, =0 {none} one {# job} other {# jobs}}</b> as {kind, select, pdf {PDF} other {a file}}'));
    assert.deepEqual(shape, {
      args: ['kind', 'n', 'who'],
      tags: ['b'],
      plurals: { n: ['one', 'other'] },
      selects: { kind: ['other', 'pdf'] },
    });
  });
});
