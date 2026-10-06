/** @jsxImportSource hono/jsx */
import { isEmployerMode } from './employer-mode';
import { newerRelease } from './update-notice';
import { APP_VERSION } from '../app-version';
import type { FC, PropsWithChildren } from 'hono/jsx';
import { raw } from 'hono/html';
import { Icon, type IconName } from './icons';
import { TOKENS, hex, rootBlock } from './tokens';
import { currentLocale } from '../i18n/locale';
import { t } from '../i18n/t';
import { LanguageInvite, LanguageMenu } from './language-menu';
import { browserMessagesJson } from './browser-messages';

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
  | 'ai'
  | 'screen'
  | 'settings';

interface LayoutProps {
  title: string;
  /** The title is data (a job's, a resume's, a screening's own name): the tab's title says so, as `PageHeader`'s `titleIsData` does. */
  titleIsData?: boolean;
  active?: NavKey;
  /** Full-page reload interval in seconds (Overview only). */
  refresh?: number;
  /**
   * App-frame mode: cap the content column at the viewport so a flex-1 region
   * inside the page can own its scrolling (Jobs table, Applications board).
   */
  fill?: boolean;
}

/** A menu item's words are the catalog's `nav.<key>`, read at render in the language of the request. */
interface NavItem {
  key: NavKey;
  href: string;
}

/** Overview stands alone above the groups; Settings is pinned below them. */
const OVERVIEW_ITEM: NavItem = { key: 'overview', href: '/' };
const SETTINGS_ITEM: NavItem = { key: 'settings', href: '/settings' };
/** Employer mode (ADR 0049): in the menu only while the switch is on. */
const SCREEN_ITEM: NavItem = { key: 'screen', href: '/screen' };

/** The menu by what a visit is for — sentence-case labels (`nav.group.<key>`), never uppercase (DESIGN.md). */
const NAV_GROUPS: { key: 'work' | 'tools' | 'research' | 'system'; items: NavItem[] }[] = [
  {
    key: 'work',
    items: [
      { key: 'jobs', href: '/jobs' },
      { key: 'applications', href: '/applications' },
    ],
  },
  {
    key: 'tools',
    items: [
      { key: 'resumes', href: '/resumes' },
      { key: 'target', href: '/target' },
      { key: 'letter', href: '/letter' },
    ],
  },
  {
    key: 'research',
    items: [
      { key: 'companies', href: '/companies' },
      { key: 'discovery', href: '/discovery' },
    ],
  },
  {
    key: 'system',
    items: [
      { key: 'runs', href: '/runs' },
      { key: 'ai', href: '/ai' },
    ],
  },
];

/**
 * The token values live in tokens.ts (pure, contrast-tested); this is where
 * they reach the page. Semantic names only (surface / line / ink / accent /
 * ok / warn / danger / info / violet): every page styles through them via
 * tailwind.config.js, so a dark theme later is a second set of values, not a
 * component rewrite. See src/web/ui.tsx for primitives.
 */
const TOKENS_CSS = `
  ${rootBlock()}
  html { color-scheme: light; }
  html, body { background-color: rgb(var(--surface)); }
  /* App shell: every scroll lives inside a pane (main, board columns).
     The window itself never scrolls — content browser extensions append
     below the frame can't drag the whole app around. */
  html, body { height: 100%; overflow: hidden; }
  ::selection { background: rgb(var(--accent) / 0.18); }
  * { scrollbar-width: thin; scrollbar-color: rgb(var(--line-strong)) transparent; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: rgb(var(--line-strong)); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgb(var(--ink-faint)); }
  ::-webkit-scrollbar-track { background: transparent; }
  :focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; border-radius: 4px; }
  /* A launcher shows one input mode at a time: the body of a mode whose own
     radio is not checked folds away (the radio reads "> label", so a checked
     radio inside a body cannot hold a closed mode open). A hidden control is
     still submitted; only a disabled one is not. Without :has() every mode
     stays open, as before 2.13. */
  @supports selector(:has(*)) {
    [data-ui="mode-card"]:not(:has(> label input[type="radio"]:checked)) > [data-ui="mode-body"] { display: none; }
    /* Settings, Schedule: the alert window's hours and days belong to one delivery mode,
       so they show while that mode is the chosen one and fold away otherwise. */
    [data-ui="alert-modes"]:not(:has(input[name="alertMode"][value="window"]:checked)) [data-ui="alert-window"] { display: none; }
  }
  /* A "contents" disclosure hands its summary and its body to the flex row it sits in
     (a toolbar's Filters, the Add sources buttons, a run's Details). Where the browser
     wraps the body in ::details-content, that box is the flex item, not the div inside it:
     open, it takes the full row under the buttons and lays its children out with the
     row's gap (the Jobs panel's "More…" places were glued together without it); closed, it
     leaves the flow — still in the page, so find-in-page can open it — or each closed
     disclosure would hold an empty row. A browser without the pseudo-element ignores both
     rules and the body's own basis-full / order-last classes do the job. */
  details.contents:not([open])::details-content { position: absolute; }
  details.contents[open]::details-content {
    display: flex; flex-wrap: wrap; gap: 0.375rem; flex-basis: 100%; order: 9999; min-width: 0;
  }
  .skip-link { position: absolute; left: -999px; top: 8px; z-index: 50; }
  .skip-link:focus { left: 8px; }
  /* Navigation progress (public/progress.mjs). Above the skip link and the
     mobile sidebar, so it stays visible whatever is open. The transition
     matches the script's tick, making the creep continuous rather than steppy;
     reduced-motion flattens it via the global rule below. */
  #page-progress {
    position: fixed; top: 0; left: 0; z-index: 60; height: 3px; width: 100%;
    background: rgb(var(--accent)); transform: scaleX(0); transform-origin: 0 50%;
    transition: transform 120ms linear; pointer-events: none;
    /* Same emerald as the AP mark, but a hairline reads lighter than a solid
       square — the glow carries the brand colour at this thickness. */
    box-shadow: 0 0 8px rgb(var(--accent) / 0.55);
  }
  #page-progress[hidden] { display: none; }
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
    /* iteration-count too: an infinite spinner at 0.01ms is not still, it is
       a repaint storm (audit 2026-09-10, A11Y-4). */
    *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; }
  }
`;


/** Direction contract — audited at the finish review; keep in sync with DESIGN.md. */
const DIRECTION_CONTRACT = `<!--
THESIS: A job-search console read twice a day: clear, crisp, light. The numbers lead, the chrome stays out of the way.
OWN-WORLD: Canvas ground (${hex(TOKENS.surface)}), white cards and a white menu, a subtle third surface (${hex(TOKENS['surface-overlay'])}) for table headers and wells, ${hex(TOKENS.line)} outlines; a type ladder of title / kpi / section / entity / body / label / meta; Inter for UI, mono reserved for machine values; emerald is the one brand accent; status speaks in tinted pills and icon tiles (blue/amber/emerald/violet/gray).
STORY: The user opens Overview, reads four numbers and the trend, scans the newest alerts, drills into a job, acts - apply, save, verify, compare - without ceremony.
FIRST VIEWPORT: 240px menu left; content fills the rest: title row, four KPI cards with their sparklines, the matches chart beside pipeline health and recent activity.
FORM: Brief-pinned light ops console (Linear density, Stripe forms, GitHub tables); the brief pins the world, no seed roll.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`;

const PROGRESS_BOOT = `
import { init } from '/static/progress.mjs';
init();
`;

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
  titleIsData = false,
  active,
  refresh,
  fill = false,
  children,
}) => (
  <>
    {/* Without the doctype the browser renders the dashboard in quirks mode —
        every <form> grew a 1em bottom margin, which is what put a form-wrapped
        button below its bare neighbour (#153). */}
    {raw('<!DOCTYPE html>')}
    <html lang={currentLocale()}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {refresh && <meta http-equiv="refresh" content={String(refresh)} />}
      <title translate={titleIsData ? 'no' : undefined}>{title} · ApplyPack</title>
      <link
        rel="icon"
        href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23059669'/%3E%3Ctext x='16' y='21.5' font-family='system-ui,sans-serif' font-size='13' font-weight='600' fill='white' text-anchor='middle'%3EAP%3C/text%3E%3C/svg%3E"
      />
      {/* The committed Tailwind build and the bundled Inter (npm run css):
          nothing on a dashboard page is fetched from a third party (2.7.0). */}
      {/* Versioned, so a browser that kept the old sheet takes the new one after an upgrade:
          a class a release added would otherwise have no rule until its cache let go. */}
      <link rel="stylesheet" href={`/static/tailwind.css?v=${APP_VERSION}`} />
      <style dangerouslySetInnerHTML={{ __html: TOKENS_CSS }} />
      <BrowserMessages />
    </head>
    <body class="bg-surface font-sans text-sm text-ink antialiased">
      {raw(DIRECTION_CONTRACT)}
      <div id="page-progress" aria-hidden="true" hidden></div>
      <a
        href="#main"
        class="skip-link rounded-md bg-accent-strong px-3 py-1.5 text-sm font-medium text-white"
      >
        {t('layout.skip')}
      </a>
      <div class="flex h-dvh overflow-hidden">
        <Sidebar active={active} />
        <div class="flex h-full min-w-0 flex-1 flex-col">
          <MobileBar />
          {/* The scroll box is positioned so that an absolute child — every sr-only label — lives inside it. Unpositioned,
              those children sat against the page at their own depth, made the document taller than the window, and a
              #anchor (#language after a switch, #updates) scrolled the whole frame up past the menu. */}
          <main id="main" class="relative min-w-0 flex-1 overflow-y-auto">
            <div
              class={`flex w-full flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-7 ${
                fill ? 'h-full' : 'min-h-full'
              }`}
            >
              <LanguageInvite place="main" />
              {children}
            </div>
          </main>
        </div>
      </div>
      <div id="nav-backdrop" class="nav-backdrop" aria-hidden="true"></div>
      <script dangerouslySetInnerHTML={{ __html: NAV_JS }} />
      <script type="module" dangerouslySetInnerHTML={{ __html: PROGRESS_BOOT }} />
    </body>
  </html>
  </>
);

/**
 * The words the page modules write after the page loads (public/i18n.mjs), in
 * the page's language. English needs nothing: the modules carry it.
 */
const BrowserMessages: FC = () => {
  const json = browserMessagesJson(currentLocale());
  return json ? <script type="application/json" id="i18n-messages" dangerouslySetInnerHTML={{ __html: json }} /> : null;
};

/** The menu's icons, by the family's own names (icons.tsx). */
const NAV_ICON: Record<NavKey, IconName> = {
  overview: 'layout-dashboard',
  jobs: 'briefcase',
  applications: 'kanban',
  resumes: 'file-text',
  target: 'target',
  letter: 'mail',
  companies: 'building',
  discovery: 'radar',
  runs: 'activity',
  ai: 'chart-column',
  screen: 'users',
  settings: 'settings',
};

/** The AP mark: the one solid emerald square on a page. */
const BrandMark: FC<{ class?: string }> = ({ class: className = 'h-8 w-8' }) => (
  <span translate="no" class={`grid shrink-0 place-items-center rounded-md bg-accent text-label font-bold tracking-tight text-white shadow-sm ${className}`}>
    AP
  </span>
);

const NavLink: FC<{ item: NavItem; active?: NavKey }> = ({ item, active }) => {
  const current = active === item.key;
  const label = t(`nav.${item.key}`);
  return (
    <a
      href={item.href}
      aria-current={current ? 'page' : undefined}
      aria-label={label}
      title={label}
      class={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 md:justify-center md:px-0 lg:justify-start lg:px-3 ${
        current
          ? // Never a fill alone: the bar at the menu's edge, the emerald text and the weight say "you are here" too.
            'bg-surface-selected font-semibold text-accent-strong before:absolute before:inset-y-1.5 before:-left-3 before:w-1 before:rounded-r-full before:bg-accent-strong md:before:-left-2.5 lg:before:-left-3'
          : 'font-medium text-ink-muted hover:bg-surface-overlay hover:text-ink'
      }`}
    >
      <Icon name={NAV_ICON[item.key]} size={18} />
      <span class="truncate md:hidden lg:block">{label}</span>
    </a>
  );
};

const Sidebar: FC<{ active?: NavKey }> = ({ active }) => (
  <aside class="app-sidebar flex h-full shrink-0 flex-col border-r border-line bg-surface-raised md:w-16 lg:w-60">
    <div class="flex h-16 shrink-0 items-center px-5 md:justify-center md:px-0 lg:justify-start lg:px-5">
      <a href="/" class="flex items-center gap-2.5" title="ApplyPack" translate="no">
        <BrandMark />
        <span class="text-section text-ink md:hidden lg:block">ApplyPack</span>
      </a>
    </div>
    <nav aria-label={t('layout.primaryNav')} class="flex-1 overflow-y-auto px-3 pb-3 pt-1 md:px-2.5 lg:px-3">
      <NavLink item={OVERVIEW_ITEM} active={active} />
      {NAV_GROUPS.map((group) => {
        const id = `nav-${group.key}`;
        const items = group.key === 'system' && isEmployerMode() ? [...group.items, SCREEN_ITEM] : group.items;
        return (
          <div role="group" aria-labelledby={id} class="mt-5 md:mt-3 lg:mt-5">
            {/* The label where there is room for words; a hairline in its place on the icon rail. */}
            <div id={id} class="px-3 pb-1.5 text-label text-ink-faint md:hidden lg:block">
              {t(`nav.group.${group.key}`)}
            </div>
            <div class="mx-auto mb-3 hidden h-px w-6 bg-line-strong md:block lg:hidden" aria-hidden="true" />
            <div class="space-y-0.5">
              {items.map((n) => (
                <NavLink item={n} active={active} />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
    <div class="shrink-0 space-y-2 border-t border-line px-3 py-3 md:px-2.5 lg:px-3">
      <NavLink item={SETTINGS_ITEM} active={active} />
      <LanguageMenu variant="sidebar" />
      <LanguageInvite place="sidebar" />
      <p class="px-3 text-meta leading-4 text-ink-faint md:hidden lg:block">
        {t('layout.local')}
      </p>
      <VersionLine />
    </div>
  </aside>
);

/** Which release this is, and — when the optional check has seen one — that a newer one is out (TASKS N9). */
const VersionLine: FC = () => {
  const newer = newerRelease();
  return (
    <p class="px-3 text-meta leading-4 text-ink-faint md:hidden lg:block">
      <span translate="no">ApplyPack v{APP_VERSION}</span>
      {newer && (
        <>
          {' · '}
          <a href="/settings?tab=general#updates" class="font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep">
            {t('layout.newer', { version: newer })}
          </a>
        </>
      )}
    </p>
  );
};

const MobileBar: FC = () => (
  <header class="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface-raised px-4 md:hidden">
    <button
      type="button"
      id="nav-toggle"
      aria-expanded="false"
      aria-label={t('layout.openNav')}
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
    <BrandMark class="h-7 w-7" />
    <span class="text-entity text-ink" translate="no">
      ApplyPack
    </span>
  </header>
);
