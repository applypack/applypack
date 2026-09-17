/*
 * Design tokens — the light theme's values, by the semantic names every page
 * styles through (`tailwind.config.js` maps them, `layout.tsx` puts them on
 * `:root`). Pure: `tokens.test.ts` holds each text colour to WCAG AA on every
 * surface it can sit on, so a value changed here is checked, not eyeballed.
 * A dark theme later is a second record of the same shape plus the same test.
 */

export type Rgb = readonly [number, number, number];

export const TOKENS = {
  surface: [245, 247, 246], // canvas: page ground, sidebar base
  'surface-raised': [255, 255, 255], // where work happens: cards, tables, controls
  'surface-overlay': [238, 242, 240], // subtle: table header, toolbars, wells, inactive regions
  'surface-selected': [228, 241, 234], // active nav item, selected option, row hover (at 50 %)
  line: [221, 227, 224], // dividers and card outlines
  'line-strong': [200, 209, 204], // control borders
  ink: [16, 24, 40],
  'ink-muted': [71, 84, 103],
  'ink-faint': [95, 107, 126], // passes AA on all four surfaces
  accent: [5, 150, 105], // ring, mark, tints
  'accent-strong': [4, 120, 87], // text, links, primary button
  'accent-deep': [6, 95, 70], // hover
  ok: [4, 120, 87],
  warn: [162, 79, 10],
  danger: [180, 35, 24],
  info: [29, 78, 216],
  violet: [109, 40, 217],
} as const satisfies Record<string, Rgb>;

export type TokenName = keyof typeof TOKENS;

/** The `:root` block: one `--name: r g b;` per token, consumed as `rgb(var(--name) / alpha)`. */
export function rootBlock(tokens: Record<string, Rgb> = TOKENS): string {
  const lines = Object.entries(tokens).map(([name, [r, g, b]]) => `    --${name}: ${r} ${g} ${b};`);
  return `:root {\n${lines.join('\n')}\n  }`;
}

/** `#RRGGBB`, for the two places CSS variables cannot reach: a data-URI and a comment. */
export function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** `fg` at `alpha` over `bg` — what a `bg-ok/10` pill really is. */
export function blend(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  const mix = (i: 0 | 1 | 2) => Math.round(alpha * fg[i] + (1 - alpha) * bg[i]);
  return [mix(0), mix(1), mix(2)];
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
