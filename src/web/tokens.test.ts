import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TOKENS, blend, contrast, hex, rootBlock, type Rgb, type TokenName } from './tokens';

const AA = 4.5;
const WHITE: Rgb = [255, 255, 255];
const SURFACES: TokenName[] = ['surface', 'surface-raised', 'surface-overlay', 'surface-selected'];
const TONES: TokenName[] = ['ok', 'warn', 'danger', 'info', 'violet'];

const passes = (fg: Rgb, bg: Rgb, floor: number, what: string) => {
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= floor, `${what}: ${ratio.toFixed(2)} < ${floor} (${hex(fg)} on ${hex(bg)})`);
};

describe('contrast arithmetic', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    assert.equal(Math.round(contrast([0, 0, 0], WHITE)), 21);
    assert.equal(contrast(TOKENS.ink, TOKENS.ink), 1);
  });

  it('blends a tint over its ground the way bg-tone/10 paints it', () => {
    assert.deepEqual(blend([0, 0, 0], WHITE, 0.1), [230, 230, 230]);
    assert.deepEqual(blend(TOKENS.ok, WHITE, 1), [...TOKENS.ok]);
  });
});

describe('text on surfaces (WCAG 2.1 AA, normal text)', () => {
  for (const ink of ['ink', 'ink-muted', 'ink-faint', 'accent-strong'] as const) {
    for (const surface of SURFACES) {
      it(`${ink} on ${surface}`, () => passes(TOKENS[ink], TOKENS[surface], AA, `${ink} on ${surface}`));
    }
  }

  it('the row hover — selected at 50 % over white — still carries faint text', () => {
    passes(TOKENS['ink-faint'], blend(TOKENS['surface-selected'], WHITE, 0.5), AA, 'ink-faint on the row hover');
  });
});

describe('status tones', () => {
  for (const tone of TONES) {
    it(`${tone}: on white, on its 10 % pill, on its 5 % flash, on the canvas`, () => {
      passes(TOKENS[tone], WHITE, AA, `${tone} on white`);
      passes(TOKENS[tone], blend(TOKENS[tone], WHITE, 0.1), AA, `${tone} on its pill`);
      passes(TOKENS[tone], blend(TOKENS[tone], WHITE, 0.05), AA, `${tone} on its flash`);
      passes(TOKENS[tone], TOKENS.surface, AA, `${tone} on the canvas`);
    });
  }

  it('an emerald chip reads on every ground it is laid on', () => {
    for (const ground of ['surface', 'surface-raised'] as const) {
      passes(TOKENS['accent-strong'], blend(TOKENS.accent, TOKENS[ground], 0.1), AA, `accent-strong on accent/10 over ${ground}`);
    }
  });
});

describe('filled buttons and the focused control', () => {
  it('white text on the solid buttons', () => {
    for (const fill of ['accent-strong', 'accent-deep', 'warn'] as const) passes(WHITE, TOKENS[fill], AA, `white on ${fill}`);
  });

  it('the focused control border is a 3:1 indicator against the control and the page', () => {
    passes(TOKENS['accent-strong'], WHITE, 3, 'focus border on white');
    passes(TOKENS['accent-strong'], TOKENS.surface, 3, 'focus border on the canvas');
  });
});

describe('the :root block', () => {
  it('declares every token once as an RGB triplet', () => {
    const css = rootBlock();
    for (const [name, [r, g, b]] of Object.entries(TOKENS)) {
      assert.equal(css.split(`--${name}: ${r} ${g} ${b};`).length, 2, name);
    }
    assert.match(css, /^:root \{\n/);
  });

  it('writes a hex for the places a CSS variable cannot reach', () => {
    assert.equal(hex(TOKENS['ink-faint']), '#5F6B7E');
    assert.equal(hex(TOKENS.warn), '#A24F0A');
    assert.equal(hex(TOKENS.danger), '#B42318');
  });
});
