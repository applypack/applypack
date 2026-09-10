/*
 * The dashboard's Tailwind build (ADR 0040's dashboard is server-rendered;
 * this is its only build step). `npm run css` writes the committed
 * src/web/public/tailwind.css from every class the pages, primitives and
 * browser modules mention. Until 2.7.0 the Play CDN compiled the same theme
 * in the browser on every page load, from a third-party script with full
 * DOM access on the origin that renders resumes (audit 2026-09-10, PRIV-1).
 * The colours are the tokens in src/web/layout.tsx, by name.
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
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
};
