/*
 * The dashboard's Tailwind build (ADR 0040's dashboard is server-rendered;
 * this is its only build step). `npm run css` writes the committed
 * src/web/public/tailwind.css from every class the pages, primitives and
 * browser modules mention. Until 2.7.0 the Play CDN compiled the same theme
 * in the browser on every page load, from a third-party script with full
 * DOM access on the origin that renders resumes (audit 2026-09-10, PRIV-1).
 * The colours are the tokens in src/web/tokens.ts, by name; the named sizes
 * are the type ladder (DESIGN.md) — size, line, tracking and weight in one
 * class, so a page writes `text-title`, not four utilities. The radii and
 * the shadows are the design's own steps under Tailwind's names.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/web/**/*.{ts,tsx,mjs}'],
  // The one place a class is built rather than written: table-hide.ts folds a
  // column at a breakpoint by cell index. The scanner cannot see those, so
  // every shape it can produce is listed (self-contained.test.ts checks).
  safelist: [
    // Every shape table-hide.ts can produce, spelled out: a pattern cannot
    // enumerate an arbitrary variant, and the scanner cannot see a class
    // that is assembled at render time (self-contained.test.ts checks).
    ...['sm', 'md', 'lg', 'xl'].flatMap((bp) => [
      `${bp}:table-cell`,
      ...Array.from({ length: 12 }, (_, i) => `${bp}:[&_td:nth-child(${i + 1})]:table-cell`),
    ]),
    ...Array.from({ length: 12 }, (_, i) => `[&_td:nth-child(${i + 1})]:hidden`),
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay) / <alpha-value>)',
          selected: 'rgb(var(--surface-selected) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          strong: 'rgb(var(--accent-strong) / <alpha-value>)',
          deep: 'rgb(var(--accent-deep) / <alpha-value>)',
        },
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        violet: 'rgb(var(--violet) / <alpha-value>)',
      },
      fontSize: {
        title: ['30px', { lineHeight: '36px', letterSpacing: '-0.025em', fontWeight: '700' }],
        kpi: ['32px', { lineHeight: '36px', letterSpacing: '-0.03em', fontWeight: '700' }],
        section: ['18px', { lineHeight: '26px', letterSpacing: '-0.015em', fontWeight: '650' }],
        entity: ['15px', { lineHeight: '22px', letterSpacing: '-0.005em', fontWeight: '600' }],
        label: ['13px', { lineHeight: '18px', fontWeight: '550' }],
        note: ['13px', { lineHeight: '20px', fontWeight: '400' }],
        meta: ['12px', { lineHeight: '16px', fontWeight: '400' }],
      },
      // The shape ladder (DESIGN.md → Shapes): 8px for a control, 12px for a
      // card. The names stay Tailwind's, so every rounded-md / rounded-lg
      // written before 2.40.0 took the new step without an edit.
      borderRadius: {
        md: '8px',
        lg: '12px',
      },
      // Tinted with the ink, never black: sm sits under a control, card under
      // a raised surface, pop under what floats (a menu, a tooltip, a popover).
      boxShadow: {
        sm: '0 1px 2px 0 rgb(13 20 33 / 0.06)',
        card: '0 1px 2px 0 rgb(13 20 33 / 0.04), 0 2px 8px -2px rgb(13 20 33 / 0.06)',
        pop: '0 4px 8px -2px rgb(13 20 33 / 0.08), 0 16px 32px -8px rgb(13 20 33 / 0.16)',
      },
      fontFamily: {
        // Noto Sans Devanagari stands in for the script Inter does not draw (src/web/tailwind.css).
        sans: ['Inter', '"Noto Sans Devanagari"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
};
