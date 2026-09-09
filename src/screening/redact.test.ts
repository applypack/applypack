import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRedactions, detectName, findLeaks, redactApplicant } from './redact';

const UA_CV = `Олена Петренко
Senior QA Engineer
Київ, Україна · +380 67 123 45 67 · olena.petrenko@gmail.com · linkedin.com/in/olena-petrenko
Дата народження: 12.05.1990 · Сімейний стан: заміжня, двоє дітей · Громадянство: Україна
вул. Хрещатик 22, кв. 14

ДОСВІД
Senior QA Engineer, SoftServe — березень 2021 – дотепер
- Побудувала автоматизацію на Playwright для 40 сервісів, зменшила регрес з 3 днів до 4 годин
QA Engineer, EPAM — 2017 – 2021
- Тестування платіжного шлюзу; Петренко відповідала за релізи

ОСВІТА
КПІ ім. Сікорського, магістр комп'ютерних наук, 2012 – 2017
`;

const EN_CV = `# Marcus Ade-Williams
Backend Engineer | London, UK
marcus@example.co.uk | (+44) 7700 900123 | https://github.com/madewilliams
Born 3 March 1988 · Married · British

EXPERIENCE
Backend Engineer, Monzo (Jan 2020 – Present)
- Owned the payments ledger service, 12k rps
Software Engineer, Ade-Williams Consulting (2016 – 2019)

EDUCATION
BSc Computer Science, University of Leeds, 2009 – 2012
`;

test('detectName reads the header line and an explicit field', () => {
  assert.equal(detectName(UA_CV), 'Олена Петренко');
  assert.equal(detectName(EN_CV), 'Marcus Ade-Williams');
  assert.equal(detectName('Name: Jane Q. Doe\nEngineer'), 'Jane Q. Doe');
  assert.equal(detectName('Senior Software Engineer Resume\nJane Doe'), null, 'a title is not a name');
  assert.equal(detectName('john.doe@example.com\nJohn Doe'), null, 'the first line must be the name');
});

test('redactApplicant removes the person and keeps the work — Ukrainian header', () => {
  const r = redactApplicant(UA_CV, 7);
  assert.equal(r.name, 'Олена Петренко');
  assert.equal(r.email, 'olena.petrenko@gmail.com');
  assert.ok(r.phone?.includes('380'));
  assert.ok(r.text.startsWith('Applicant №7\n'));
  assert.ok(!/Петренко|Олена/.test(r.text), 'name gone, including the surname inside a bullet');
  assert.ok(!/gmail|linkedin|380 67/.test(r.text));
  assert.ok(!/1990|Дата народження|заміжня|дітей|Громадянство|Хрещатик/.test(r.text));
  assert.ok(r.text.includes('Київ, Україна'), 'the city stays for a location gate');
  assert.ok(r.text.includes('Playwright для 40 сервісів'), 'the work stays');
  assert.ok(r.text.includes('березень 2021 – дотепер'), 'role dates stay');
  assert.ok(!/2012 – 2017/.test(r.text), 'graduation years go');
  assert.ok(r.text.includes("магістр комп'ютерних наук"), 'the degree stays');
  assert.deepEqual(findLeaks(r.text, r), []);
  const kinds = r.redactions.map((x) => x.kind);
  for (const k of ['name', 'email', 'phone', 'link', 'birth', 'marital', 'citizenship', 'address', 'graduation']) {
    assert.ok(kinds.includes(k as never), `redaction kind ${k} reported`);
  }
});

test('redactApplicant — English header, hyphenated surname, markdown title', () => {
  const r = redactApplicant(EN_CV, 12);
  assert.equal(r.name, 'Marcus Ade-Williams');
  assert.ok(!/Marcus|Ade-Williams|Williams/.test(r.text), 'the surname is also an employer name — it goes too');
  assert.ok(!/example\.co\.uk|github|7700 900123|Born|1988|Married|British/.test(r.text));
  assert.ok(r.text.startsWith('# Applicant №12\n'), 'a markdown name heading is the label line, not doubled');
  assert.ok(r.text.includes('Backend Engineer | London, UK'));
  assert.ok(r.text.includes('Jan 2020 – Present'));
  assert.ok(!/2009 – 2012/.test(r.text));
  assert.ok(r.text.includes('University of Leeds'));
  assert.deepEqual(findLeaks(r.text, r), []);
});

test('redactApplicant leaves ordinary sentences alone', () => {
  const text = `Ivan Koval
Engineer
Kyiv
- 5 років досвіду в single-page applications; married the API to a new queue in 2 days
- Age of the codebase: 12 years; reduced p99 latency from 900 ms to 120 ms
- Built the Playwright end-to-end suite for 40 microservices; cut the regression cycle from 3 days to 4 hours
- Paved the road to 5 nines with a lane-based deploy
`;
  const r = redactApplicant(text, 1);
  assert.ok(r.text.includes('end-to-end suite for 40 microservices'), '"suite for 40" is a test suite, not an address');
  assert.ok(r.text.includes('road to 5 nines'), 'a road with no number next to it is a metaphor');
  assert.ok(r.text.includes('5 років досвіду'), '"5 years of experience" is not an age');
  assert.ok(r.text.includes('single-page applications'), '"single" inside a sentence is not a marital status');
  assert.ok(r.text.includes('married the API'), 'a verb, not a field');
  assert.ok(r.text.includes('120 ms'), 'a metric is not a phone number');
  assert.ok(!/Koval/.test(r.text));
});

test('redactApplicant removes street lines in the shapes headers write them', () => {
  const text = `Jane Doe
Engineer
22 Baker Street, London NW1 · Suite 200
вул. Хрещатик 22, кв. 14, Київ
Musterstraße 5, 10115 Berlin
ul. Długa 12/3, Kraków
`;
  const r = redactApplicant(text, 2);
  assert.ok(!/Baker Street|Suite 200|Хрещатик|кв\. 14|Musterstraße|Długa/.test(r.text), r.text);
  assert.ok(r.text.includes('London NW1'), 'the city segment stays');
  assert.ok(r.text.includes('Київ'));
  assert.equal(r.redactions.find((x) => x.kind === 'address')?.count, 6);
});

test('redactApplicant with no detectable name still strips contacts', () => {
  const r = redactApplicant('Resume\nengineer@corp.io · +1 415 555 0100\nBuilt things.', 3);
  assert.equal(r.name, null);
  assert.ok(!/corp\.io|555 0100/.test(r.text));
  assert.deepEqual(findLeaks(r.text, r), []);
});

test('findLeaks names what survived', () => {
  const leaks = findLeaks('Applicant №1\nJane at jane@x.io, see linkedin.com/in/jane', { name: 'Jane Doe', email: 'jane@x.io', phone: null });
  assert.deepEqual(leaks, ['email', 'link', 'name:Jane']);
});

test('describeRedactions reads like an audit line', () => {
  assert.equal(
    describeRedactions([
      { kind: 'name', count: 3 },
      { kind: 'email', count: 1 },
      { kind: 'link', count: 2 },
      { kind: 'birth', count: 1 },
    ]),
    'name, 1 email, 2 links, date of birth',
  );
  assert.equal(describeRedactions([]), 'nothing to remove');
});
