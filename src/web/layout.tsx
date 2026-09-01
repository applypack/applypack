/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import { raw } from 'hono/html';

export type NavKey =
  | 'overview'
  | 'jobs'
  | 'applications'
  | 'resumes'
  | 'target'
  | 'letter'
  | 'companies'
  | 'discovery'
  | 'runs'
  | 'settings';

interface LayoutProps {
  title: string;
  active?: NavKey;
  /** Full-page reload interval in seconds (Overview only). */
  refresh?: number;
  /**
   * App-frame mode: cap the content column at the viewport so a flex-1 region
   * inside the page can own its scrolling (Jobs table, Applications board).
   */
  fill?: boolean;
}

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: 'overview', href: '/', label: 'Overview' },
  { key: 'jobs', href: '/jobs', label: 'Jobs' },
  { key: 'applications', href: '/applications', label: 'Applications' },
  { key: 'resumes', href: '/resumes', label: 'Resumes' },
  { key: 'target', href: '/target', label: 'Compare' },
  { key: 'letter', href: '/letter', label: 'Cover letter' },
  { key: 'companies', href: '/companies', label: 'Companies' },
  { key: 'discovery', href: '/discovery', label: 'Discovery' },
  { key: 'runs', href: '/runs', label: 'Runs' },
];

const SETTINGS_ITEM = { key: 'settings' as NavKey, href: '/settings', label: 'Settings' };

/**
 * Design tokens — light theme. Semantic names only (surface / line / ink /
 * accent / ok / warn / danger / info / violet); every page styles through
 * these via the Tailwind config below, so a dark theme later is a second
 * set of values, not a component rewrite. See src/web/ui.tsx for primitives.
 */
const TOKENS_CSS = `
  :root {
    --surface: 247 248 250;         /* app background */
    --surface-raised: 255 255 255;  /* cards, tables, panels */
    --surface-overlay: 243 244 246; /* subtle fills, hovers, wells */
    --line: 229 231 235;            /* hairline borders */
    --line-strong: 208 213 221;     /* control borders */
    --ink: 16 24 40;                /* primary text */
    --ink-muted: 71 84 103;         /* secondary text */
    --ink-faint: 102 112 133;       /* muted text */
    --accent: 5 150 105;            /* brand emerald - focus, highlights */
    --accent-strong: 4 120 87;      /* links, primary buttons (AA on white) */
    --accent-deep: 6 95 70;         /* primary button hover */
    --ok: 4 120 87;
    --warn: 180 83 9;
    --danger: 217 45 32;
    --info: 29 78 216;
    --violet: 109 40 217;
  }
  html { color-scheme: light; }
  html, body { background-color: rgb(var(--surface)); }
  ::selection { background: rgb(var(--accent) / 0.18); }
  * { scrollbar-width: thin; scrollbar-color: rgb(var(--line-strong)) transparent; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: rgb(var(--line-strong)); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgb(var(--ink-faint)); }
  ::-webkit-scrollbar-track { background: transparent; }
  :focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; border-radius: 4px; }
  .skip-link { position: absolute; left: -999px; top: 8px; z-index: 50; }
  .skip-link:focus { left: 8px; }
  @media (max-width: 767.98px) {
    .app-sidebar {
      position: fixed; top: 0; bottom: 0; left: 0; z-index: 40; width: 16rem;
      transform: translateX(-100%); transition: transform 200ms ease;
      box-shadow: 0 8px 30px rgb(16 24 40 / 0.12);
    }
    html[data-nav-open] .app-sidebar { transform: none; }
    .nav-backdrop { display: none; position: fixed; inset: 0; z-index: 30; background: rgb(16 24 40 / 0.4); }
    html[data-nav-open] .nav-backdrop { display: block; }
  }
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
`;

/** Direction contract — audited at the finish review; keep in sync with DESIGN.md. */
const DIRECTION_CONTRACT = `<!--
THESIS: A hunting console read twice a day: dense, calm, light. Refuses both the dark hacker-dashboard and the roomy marketing-admin.
OWN-WORLD: Paper-gray ground (#F7F8FA), white work surfaces, hairline #E5E7EB borders, Inter for UI, mono reserved for machine values; emerald is the one brand accent; status speaks in quiet tinted pills (blue/amber/emerald/violet/gray).
STORY: The user opens Overview, reads four numbers and the newest alerts, drills into a job, acts - apply, save, verify, compare - without ceremony.
FIRST VIEWPORT: 240px sidebar left; content fills the rest: title row, four stat cards with 24h deltas, alerts list beside cron health.
FORM: Brief-pinned light ops console (Linear density, Stripe forms, GitHub tables); the brief pins the world, no seed roll.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`;

const NAV_JS = `
  (function () {
    var toggle = document.getElementById('nav-toggle');
    if (!toggle) return;
    var html = document.documentElement;
    function set(open) {
      html.toggleAttribute('data-nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    }
    toggle.addEventListener('click', function () { set(!html.hasAttribute('data-nav-open')); });
    var backdrop = document.getElementById('nav-backdrop');
    if (backdrop) backdrop.addEventListener('click', function () { set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
    var links = document.querySelectorAll('.app-sidebar a');
    for (var i = 0; i < links.length; i++) links[i].addEventListener('click', function () { set(false); });
  })();
`;

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title,
  active,
  refresh,
  fill = false,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {refresh && <meta http-equiv="refresh" content={String(refresh)} />}
      <title>{title} · ApplyPack</title>
      <link
        rel="icon"
        href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23059669'/%3E%3Ctext x='16' y='21.5' font-family='system-ui,sans-serif' font-size='13' font-weight='600' fill='white' text-anchor='middle'%3EAP%3C/text%3E%3C/svg%3E"
      />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"
      />
      <script src="https://cdn.tailwindcss.com"></script>
      <script dangerouslySetInnerHTML={{ __html: TAILWIND_CONFIG }} />
      <style dangerouslySetInnerHTML={{ __html: TOKENS_CSS }} />
    </head>
    <body class="bg-surface font-sans text-sm text-ink antialiased">
      {raw(DIRECTION_CONTRACT)}
      <a
        href="#main"
        class="skip-link rounded-md bg-accent-strong px-3 py-1.5 text-sm font-medium text-white"
      >
        Skip to content
      </a>
      <div class="flex h-dvh overflow-hidden">
        <Sidebar active={active} />
        <div class="flex h-full min-w-0 flex-1 flex-col">
          <MobileBar />
          <main id="main" class="min-w-0 flex-1 overflow-y-auto">
            <div
              class={`flex w-full flex-col px-4 py-5 sm:px-6 lg:px-8 ${
                fill ? 'h-full' : 'min-h-full'
              }`}
            >
              {children}
            </div>
          </main>
        </div>
      </div>
      <div id="nav-backdrop" class="nav-backdrop" aria-hidden="true"></div>
      <script dangerouslySetInnerHTML={{ __html: NAV_JS }} />
    </body>
  </html>
);

/* Lucide icon paths (MIT), 24px grid, stroke-based. */
const ICON_PATHS: Record<NavKey, string> = {
  overview:
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  jobs: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  applications:
    '<path d="M5 3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5Z"/><path d="M15 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2Z"/>',
  resumes:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  target:
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  letter:
    '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  companies:
    '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  discovery:
    '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62a10 10 0 1 0 19.02-1.27"/><path d="M16.24 7.76a6 6 0 1 0-8.01 8.91"/><path d="M12 18h.01"/><path d="M17.99 11.66a6 6 0 0 1-2.22 4.75"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
  runs: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
};

const NavIcon: FC<{ name: NavKey }> = ({ name }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="h-[18px] w-[18px] shrink-0"
    aria-hidden="true"
  >
    {/* hono/jsx special-cases <svg> and rejects dangerouslySetInnerHTML on it; <g> is fine. */}
    <g dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }} />
  </svg>
);

const NavLink: FC<{ item: { key: NavKey; href: string; label: string }; active?: NavKey }> = ({
  item,
  active,
}) => {
  const current = active === item.key;
  return (
    <a
      href={item.href}
      aria-current={current ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
      class={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 md:justify-center md:px-0 md:py-2 lg:justify-start lg:px-2.5 lg:py-1.5 ${
        current
          ? 'bg-surface-overlay font-medium text-ink'
          : 'text-ink-muted hover:bg-surface-overlay/70 hover:text-ink'
      }`}
    >
      <NavIcon name={item.key} />
      <span class="truncate md:hidden lg:block">{item.label}</span>
    </a>
  );
};

const Sidebar: FC<{ active?: NavKey }> = ({ active }) => (
  <aside class="app-sidebar flex h-full shrink-0 flex-col border-r border-line bg-surface md:w-16 lg:w-60">
    <div class="flex h-14 shrink-0 items-center gap-2.5 px-4 md:justify-center md:px-0 lg:justify-start lg:px-4">
      <a href="/" class="flex items-center gap-2.5" title="ApplyPack">
        <span class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-xs font-semibold text-white">
          AP
        </span>
        <span class="text-sm font-semibold tracking-tight md:hidden lg:block">ApplyPack</span>
      </a>
    </div>
    <nav aria-label="Primary" class="flex-1 space-y-0.5 overflow-y-auto px-3 py-2 md:px-2.5 lg:px-3">
      {NAV.map((n) => (
        <NavLink item={n} active={active} />
      ))}
    </nav>
    <div class="shrink-0 space-y-2 border-t border-line px-3 py-3 md:px-2.5 lg:px-3">
      <NavLink item={SETTINGS_ITEM} active={active} />
      <p class="px-2.5 text-xs leading-4 text-ink-faint md:hidden lg:block">
        Runs locally · data stays in your Postgres
      </p>
    </div>
  </aside>
);

const MobileBar: FC = () => (
  <header class="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface-raised px-4 md:hidden">
    <button
      type="button"
      id="nav-toggle"
      aria-expanded="false"
      aria-label="Open navigation"
      class="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-overlay hover:text-ink"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        class="h-5 w-5"
        aria-hidden="true"
      >
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </svg>
    </button>
    <span class="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-semibold text-white">
      AP
    </span>
    <span class="text-sm font-semibold tracking-tight">ApplyPack</span>
  </header>
);
