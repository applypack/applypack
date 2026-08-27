/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';

export type NavKey =
  | 'overview'
  | 'jobs'
  | 'applications'
  | 'companies'
  | 'discovery'
  | 'runs'
  | 'settings';

interface LayoutProps {
  title: string;
  active?: NavKey;
}

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: 'overview', href: '/', label: 'Overview' },
  { key: 'jobs', href: '/jobs', label: 'Jobs' },
  { key: 'applications', href: '/applications', label: 'Applications' },
  { key: 'companies', href: '/companies', label: 'Companies' },
  { key: 'discovery', href: '/discovery', label: 'Discovery' },
  { key: 'runs', href: '/runs', label: 'Runs' },
  { key: 'settings', href: '/settings', label: 'Settings' },
];

/**
 * Design tokens. Dark-only by design (ops dashboard, OLED-friendly).
 * Colors are exposed to Tailwind through CSS variables so every page uses
 * semantic names (surface / line / ink / accent / ok / warn / danger / info)
 * instead of raw palette steps — see src/web/ui.tsx for the primitives.
 */
const TOKENS_CSS = `
  :root {
    --surface: 11 12 16;
    --surface-raised: 19 20 26;
    --surface-overlay: 27 28 36;
    --line: 36 37 46;
    --line-strong: 52 54 66;
    --ink: 231 232 238;
    --ink-muted: 154 156 171;
    --ink-faint: 98 100 112;
    --accent: 52 211 153;
    --accent-strong: 16 185 129;
    --ok: 52 211 153;
    --warn: 251 191 36;
    --danger: 251 113 133;
    --info: 96 165 250;
    --violet: 167 139 250;
  }
  html { color-scheme: dark; }
  html, body { background-color: rgb(var(--surface)); }
  body { font-feature-settings: "cv11", "ss01"; }
  :focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; border-radius: 4px; }
  .skip-link { position: absolute; left: -999px; top: 8px; z-index: 50; }
  .skip-link:focus { left: 8px; }
  .htmx-indicator { opacity: 0; transition: opacity 200ms; }
  .htmx-request .htmx-indicator, .htmx-request.htmx-indicator { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  }
`;

const TAILWIND_CONFIG = `
  tailwind.config = {
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
          },
          ok: 'rgb(var(--ok) / <alpha-value>)',
          warn: 'rgb(var(--warn) / <alpha-value>)',
          danger: 'rgb(var(--danger) / <alpha-value>)',
          info: 'rgb(var(--info) / <alpha-value>)',
          violet: 'rgb(var(--violet) / <alpha-value>)',
        },
        fontFamily: {
          sans: ['"Fira Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
          mono: ['"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        },
      },
    },
  };
`;

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title,
  active,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · job-hunter</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Fira+Sans:wght@400;500;600&display=swap"
      />
      <script src="https://cdn.tailwindcss.com"></script>
      <script dangerouslySetInnerHTML={{ __html: TAILWIND_CONFIG }} />
      <script src="https://unpkg.com/htmx.org@2.0.4" defer></script>
      <style dangerouslySetInnerHTML={{ __html: TOKENS_CSS }} />
    </head>
    <body class="min-h-screen bg-surface font-sans text-ink antialiased">
      <a href="#main" class="skip-link rounded bg-accent px-3 py-1.5 text-sm font-medium text-surface">
        Skip to content
      </a>
      <Nav active={active} />
      <main id="main" class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <footer class="mx-auto max-w-7xl px-4 py-6 text-center text-xs text-ink-faint">
        job-hunter · runs locally · data stays in your Postgres
      </footer>
    </body>
  </html>
);

const Nav: FC<{ active?: NavKey }> = ({ active }) => (
  <header class="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur">
    <div class="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5 sm:px-6 lg:px-8">
      <a href="/" class="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight">
        <span class="grid h-7 w-7 place-items-center rounded-md bg-accent/15 font-mono text-xs text-accent ring-1 ring-inset ring-accent/30">
          JH
        </span>
        <span class="hidden sm:inline">job-hunter</span>
      </a>
      <nav
        aria-label="Primary"
        class="-mb-px flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm"
      >
        {NAV.map((n) => (
          <a
            href={n.href}
            aria-current={active === n.key ? 'page' : undefined}
            class={`shrink-0 rounded-md px-3 py-1.5 transition-colors duration-150 ${
              active === n.key
                ? 'bg-surface-overlay text-ink'
                : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
            }`}
          >
            {n.label}
          </a>
        ))}
      </nav>
    </div>
  </header>
);
