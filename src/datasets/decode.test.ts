import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeText } from './decode';

/** A string as the bytes of a one-byte encoding: the reverse of what TextDecoder offers. */
function encode(text: string, label: 'windows-1251' | 'windows-1252'): Uint8Array {
  const decoder = new TextDecoder(label);
  const byteOf = new Map<string, number>();
  for (let b = 0x80; b <= 0xff; b++) byteOf.set(decoder.decode(Uint8Array.of(b)), b);
  return Uint8Array.from([...text].map((ch) => (ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : (byteOf.get(ch) ?? 0x3f))));
}

const UK = 'Шукаємо розробника Node.js у продуктову команду. Він пише сервіси, її колеги рев’юють код; Європа, віддалено.';
const DE = 'id,title,company,location\n1,Backend Developer,Müller & Söhne,Zürich\n2,Frontend Developer,Café Noé,Kraków\n';

describe('decodeText', () => {
  it('reads UTF-8 and marked UTF-16 as what they are, with nothing assumed', () => {
    assert.deepEqual(decodeText(Buffer.from(UK, 'utf8')), { text: UK, encoding: 'utf-8', how: 'bytes', unreadable: 0 });
    assert.deepEqual(decodeText(Buffer.from('plain ASCII', 'utf8')), { text: 'plain ASCII', encoding: 'utf-8', how: 'bytes', unreadable: 0 });
    const le = Buffer.from(`﻿${UK}`, 'utf16le');
    assert.equal(decodeText(le).encoding, 'utf-16le');
    assert.equal(decodeText(Buffer.from(le).swap16()).text.replace(/^﻿/, ''), UK);
  });

  // #394: read as UTF-8, every letter past ASCII became U+FFFD — "Z\uFFFDrich", "Node.js \uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD".
  it('reads a Windows spreadsheet’s plain CSV as Windows-1252, and says the encoding was assumed', () => {
    const read = decodeText(encode(DE, 'windows-1252'));
    assert.deepEqual(read, { text: DE, encoding: 'windows-1252', how: 'assumed', unreadable: 0 });
  });

  it('tells Cyrillic from Western European by whether the letters past ASCII come in words', () => {
    const read = decodeText(encode(UK, 'windows-1251'));
    assert.deepEqual(read, { text: UK, encoding: 'windows-1251', how: 'assumed', unreadable: 0 });
    // French doubles an accented letter now and then ("créée"); most of them still stand alone.
    const fr = 'Société créée à Genève : développeur confirmé, équipe répartie, congés payés, télétravail à 100 %.';
    assert.equal(decodeText(encode(fr, 'windows-1252')).text, fr);
  });

  it('takes a page’s word for its charset, in either way a page says it, before assuming', () => {
    const body = '<body><h1>Node.js розробник</h1></body>';
    for (const head of ['<meta charset="windows-1251">', '<meta http-equiv="Content-Type" content="text/html; charset=windows-1251">', "<META CHARSET='Windows-1251'>"]) {
      const read = decodeText(encode(`<html><head>${head}</head>${body}</html>`, 'windows-1251'), { page: true });
      assert.deepEqual([read.encoding, read.how, read.text.includes('Node.js розробник')], ['windows-1251', 'declared', true], head);
    }
    const xml = decodeText(encode(`<?xml version="1.0" encoding="windows-1251"?><p>${UK}</p>`, 'windows-1251'), { page: true });
    assert.deepEqual([xml.how, xml.text.includes(UK)], ['declared', true]);
  });

  it('does not look for a declaration in a file that is not a page, nor believe one the bytes contradict', () => {
    // A CSV cell that quotes markup is not the file speaking about itself.
    const cell = encode('note,title\n"<meta charset=koi8-u>",Zürich\n', 'windows-1252');
    assert.equal(decodeText(cell).encoding, 'windows-1252');
    // A page that says UTF-8 and is not: its bytes are weighed instead.
    const lying = decodeText(encode(`<html><head><meta charset="utf-8"></head><body>${UK}</body></html>`, 'windows-1251'), { page: true });
    assert.deepEqual([lying.encoding, lying.how, lying.text.includes(UK)], ['windows-1251', 'assumed', true]);
    // A charset this runtime has no decoder for is no word at all.
    const unknown = decodeText(encode(`<html><head><meta charset="x-no-such-charset"></head><body>${UK}</body></html>`, 'windows-1251'), { page: true });
    assert.equal(unknown.how, 'assumed');
  });

  it('keeps UTF-8 that is merely damaged as UTF-8, and counts what could not be read', () => {
    const bytes = Buffer.from(UK, 'utf8');
    const damaged = Uint8Array.from(bytes);
    damaged[1] = 0x20; // the second byte of the first letter
    const read = decodeText(damaged);
    assert.deepEqual([read.encoding, read.how, read.unreadable], ['utf-8', 'bytes', 1]);
    assert.ok(read.text.includes('розробника Node.js'));
  });

  it('reads a UTF-8 file cut inside its last character as UTF-8 with one character lost', () => {
    const head = Buffer.from('id,city\n1,Zürich\n2,Krak', 'utf8');
    // "ó" is C3 B3: the file stops after its first byte, as a file still being written does.
    const cut = decodeText(Buffer.concat([head, Buffer.from([0xc3])]));
    assert.deepEqual(cut, { text: 'id,city\n1,Zürich\n2,Krak\uFFFD', encoding: 'utf-8', how: 'bytes', unreadable: 1 });
    // "€" is E2 82 AC: two of its three bytes.
    assert.equal(decodeText(Buffer.concat([head, Buffer.from([0xe2, 0x82])])).unreadable, 1);
  });

  // Found on the interface's own sentences: 58 of 1,892 French ones end in an accented letter and hold nothing else past ASCII.
  it('takes a last byte after plain ASCII for a letter, not for a character cut short', () => {
    assert.deepEqual(decodeText(encode('Activé', 'windows-1252')), { text: 'Activé', encoding: 'windows-1252', how: 'assumed', unreadable: 0 });
    assert.equal(decodeText(encode('nunca se ejecutó', 'windows-1252')).text, 'nunca se ejecutó');
    assert.equal(decodeText(encode('id,city\n1,Kraków', 'windows-1252')).text, 'id,city\n1,Kraków');
  });

  it('is not led to Cyrillic by punctuation in pairs, nor by a doubled accented letter', () => {
    for (const text of ['Solo ofertas con un veredicto de “¿Es real esta oferta?”', 'Aucune offre — « tout est lu », rien à faire.', 'Réécrire', 'Créée', 'Tout réécrire'])
      assert.deepEqual([decodeText(encode(text, 'windows-1252')).text, decodeText(encode(text, 'windows-1252')).encoding], [text, 'windows-1252']);
  });

  it('knows Ukrainian by its words, the letters windows-1251 keeps among the signs included', () => {
    for (const text of ['Дії', 'рік', 'В офісі', 'Ще не було', 'Її європейські ґудзики'])
      assert.deepEqual(decodeText(encode(text, 'windows-1251')), { text, encoding: 'windows-1251', how: 'assumed', unreadable: 0 });
  });
});
