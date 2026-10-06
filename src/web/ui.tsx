/** @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { fitTone, fitWord, formatDate, formatRelative, statusLabel, statusTone, type Tone } from './format';
import type { FlashKind, FlashMessage } from './flash';
import { hideCellsClass, hideHeaderClass, type HideBelow } from './table-hide';
import { barHeights } from './chart-svg';
import { Icon, type IconName } from './icons';
import { TOKENS, hex } from './tokens';
import { hashShortId } from '../text-utils';
import { formatNumber } from '../i18n/format';
import { t } from '../i18n/t';

/*
 * Shared primitives. Every page composes these instead of writing raw
 * Tailwind strings, so colour and spacing decisions live in one file.
 * Tones map to the semantic tokens valued in tokens.ts.
 */

/*
 * A pill paints its 12 % tint over white whatever it is laid on (the gradient
 * is the tint, the colour under it the ground), so its text contrast is one
 * number held by tokens.test.ts — not one per surface. On the canvas alone the
 * bare tint read 4.44:1 for the Applied pill. The ground is a `pill-*` class
 * from src/web/tailwind.css: written out as an arbitrary value it cost 80
 * bytes a pill, 8 KB on a resume page with a hundred skill tags.
 */
const TONE_SOFT: Record<Tone, string> = {
  ok: 'pill-ok text-ok ring-ok/25',
  warn: 'pill-warn text-warn ring-warn/25',
  danger: 'pill-danger text-danger ring-danger/25',
  info: 'pill-info text-info ring-info/25',
  violet: 'pill-violet text-violet ring-violet/25',
  neutral: 'bg-surface-overlay text-ink-muted ring-line',
};

/** A tone as text colour, and as a solid fill — one map each for every page (TASKS U18). */
export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  violet: 'text-violet',
  neutral: 'text-ink-faint',
};

export const TONE_FILL: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  violet: 'bg-violet',
  neutral: 'bg-ink-faint',
};

/* ---------- page scaffolding ---------- */

export const PageHeader: FC<
  PropsWithChildren<{
    title: string;
    meta?: string | Child;
    actions?: Child;
    /** `labelIsData`: the label is a name of the person's own (a screening's title) and is marked as data. */
    back?: { href: string; label: string; labelIsData?: boolean };
    /** The title is data — a resume's or a posting's own name — and no translator should touch it (ADR 0061). */
    titleIsData?: boolean;
  }>
> = ({ title, meta, actions, back, titleIsData = false, children }) => (
  <header class="mb-6 shrink-0">
    {back && (
      <a
        href={back.href}
        translate={back.labelIsData ? 'no' : undefined}
        class="mb-2 inline-flex items-center gap-1 text-note font-medium text-ink-faint transition-colors duration-150 hover:text-ink"
      >
        <Icon name="chevron-left" size={14} />
        {back.label}
      </a>
    )}
    {/* The title and its one sentence read as one block at the left; what the
        page offers sits at the right, level with the title. */}
    <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div class="min-w-0 flex-1 basis-64">
        {/* A name of the person's own is cut with its whole self on hover; our words wrap — a translation runs longer. */}
        <h1 class={`${titleIsData ? 'truncate' : 'break-words'} text-title text-ink`} title={title} translate={titleIsData ? 'no' : undefined}>
          {title}
        </h1>
        {children && (
          <div data-ui="hint" class="mt-1 text-sm leading-5 text-ink-muted">{children}</div>
        )}
      </div>
      {(meta || actions) && (
        <div class="flex min-h-[36px] min-w-0 flex-wrap items-center gap-3">
          {meta && <div data-ui="hint" class="text-note text-ink-faint tabular-nums">{meta}</div>}
          {actions}
        </div>
      )}
    </div>
  </header>
);

/**
 * A model's words inside a sentence of ours, as a `tRich` tag renderer
 * (`{ en: inEnglish }`): marked English, as it wrote them, whatever language
 * the page reads in (ADR 0061).
 */
export const inEnglish = (words: Child[]) => <span lang="en">{words}</span>;

/** "3 hours ago", with the date and time it stands for on hover and in the markup (TASKS R20). */
export const When: FC<{ at: Date | null | undefined }> = ({ at }) =>
  at ? (
    <time datetime={at.toISOString()} title={formatDate(at)}>
      {formatRelative(at)}
    </time>
  ) : (
    <>—</>
  );

/** A criterion's weight as stars for the eye and as a number for a screen reader (TASKS U12). */
export const Stars: FC<{ n: number; class?: string }> = ({ n, class: extra }) => (
  <span class={extra}>
    <span aria-hidden="true">{'★'.repeat(n)}</span>
    <span class="sr-only">{t('ui.weight', { n })}</span>
  </span>
);

/** A message's ground and text by tone — one map for the flash and the standing notice (TASKS U4). */
const MESSAGE_TONE = {
  ok: 'border-ok/25 bg-ok/5 text-ok',
  warn: 'border-warn/25 bg-warn/5 text-warn',
  danger: 'border-danger/25 bg-danger/5 text-danger',
} as const;

const FLASH_TONE: Record<FlashKind, string> = { ok: MESSAGE_TONE.ok, warn: MESSAGE_TONE.warn, err: MESSAGE_TONE.danger };

/**
 * What a page says on every render in a tone — the posting changed, a run
 * failed, every search is empty — in the flash's shape, which is for what one
 * action did (TASKS U4). `children` may carry its one action after the text.
 */
export const Notice: FC<PropsWithChildren<{ tone: keyof typeof MESSAGE_TONE; class?: string; role?: 'status' | 'alert' }>> = ({
  tone,
  class: extra,
  role,
  children,
}) => <div role={role} class={`rounded-md border px-3.5 py-2.5 text-note leading-5 ${MESSAGE_TONE[tone]}${extra ? ` ${extra}` : ''}`}>{children}</div>;

/** `children` is the message's one action, if any — a form or a button after the text. */
export const Flash: FC<PropsWithChildren<{ flash?: FlashMessage | null }>> = ({ flash, children }) =>
  flash ? (
    <>
    <div
      role="status"
      class={`mb-4 flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm ${FLASH_TONE[flash.kind]}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="mt-0.5 h-4 w-4 shrink-0"
        aria-hidden="true"
      >
        {flash.kind === 'ok' ? (
          <>
            <circle cx="12" cy="12" r="10" />
            <path d="m9 12 2 2 4-4" />
          </>
        ) : flash.kind === 'warn' ? (
          <>
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </>
        )}
      </svg>
      <span id="flash-text" class="min-w-0 flex-1">{flash.text}</span>
      {flash.download && (
        <a href={flash.download} class="shrink-0 font-medium underline">
          {t('ui.downloadDocx')}
        </a>
      )}
      {children}
    </div>
    {/* TASKS U15: the field the message is about says so itself — invalid, described by the message, focused.
        Looked up inside the form that posted; both parts passed flash.ts's patterns, so neither can close a quote.
        Focused on load: the jump to a redirect's #fragment comes after this script and takes the focus back. */}
    {flash.field && (
      <script
        type="module"
        dangerouslySetInnerHTML={{
          __html: `const f = document.querySelector('form[action=${JSON.stringify(flash.field.form)}] [name=${JSON.stringify(flash.field.name)}]'); if (f) { f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', ['flash-text', f.getAttribute('aria-describedby')].filter(Boolean).join(' ')); const focus = () => f.focus(); if (document.readyState === 'complete') focus(); else addEventListener('load', focus, { once: true }); }`,
        }}
      />
    )}
    </>
  ) : null;

const CARD_VARIANT = {
  /** An object that stands alone: raised, outlined, a soft shadow under it. */
  card: 'rounded-lg border border-line bg-surface-raised shadow-card',
  /** A part of a region that is already one surface: no border, shadow or fill of its own. */
  flat: '',
  /** A well or an inactive region: the subtle fill, no outline. */
  subtle: 'rounded-lg bg-surface-overlay',
} as const;

export const Card: FC<
  PropsWithChildren<{ class?: string; flush?: boolean; id?: string; variant?: keyof typeof CARD_VARIANT }>
> = ({ children, class: className = '', flush = false, id, variant = 'card' }) => (
  <section
    id={id}
    class={`${CARD_VARIANT[variant]} ${flush ? 'overflow-hidden' : variant === 'flat' ? '' : 'p-5'} ${className}`}
  >
    {children}
  </section>
);

/** `card` heads a card; `section` heads a page-level section outside one (the type ladder, DESIGN.md). */
export const SectionTitle: FC<PropsWithChildren<{ level?: 'card' | 'section' }>> = ({ children, level = 'card' }) => (
  <h2 class={`text-ink ${level === 'section' ? 'mb-4 text-section' : 'mb-3 text-entity'}`}>{children}</h2>
);

/**
 * What a card holds, said at its top: the title at the left — with `info`, the
 * sentence that explains it, one hover or focus away — and the card's one way
 * onward (`action`: a link, a control) at the right. `children` ride beside
 * the title: a badge, a quiet "(30 days)".
 */
export const CardHeader: FC<PropsWithChildren<{ title: string; info?: string; action?: Child; class?: string }>> = ({
  title,
  info,
  action,
  class: className = 'mb-4',
  children,
}) => (
  <div class={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`}>
    <div class="flex min-w-0 items-center gap-2">
      <h2 class="break-words text-section text-ink">{title}</h2>
      {children}
      {info && <InfoTip text={info} />}
    </div>
    {action}
  </div>
);

/** A card's quiet way onward: "View all →". */
export const CardLink: FC<PropsWithChildren<{ href: string }>> = ({ href, children }) => (
  <a
    href={href}
    class="inline-flex shrink-0 items-center gap-1 text-note font-medium text-accent-strong transition-colors duration-150 hover:text-accent-deep"
  >
    {children}
    <Icon name="arrow-right" size={14} />
  </a>
);

/**
 * One sentence behind an (i): shown on hover and on keyboard or touch focus,
 * with no script. The button's name is the sentence, so a screen reader hears
 * it where a mouse sees it.
 */
const InfoTip: FC<{ text: string }> = ({ text }) => (
  <span class="group/tip relative inline-flex">
    <button
      type="button"
      aria-label={text}
      class="rounded-full text-ink-faint transition-colors duration-150 hover:text-ink-muted"
    >
      <Icon name="info" size={16} />
    </button>
    <span
      role="tooltip"
      class="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-line bg-surface-raised px-3 py-2 text-note text-ink-muted shadow-pop group-focus-within/tip:block group-hover/tip:block"
    >
      {text}
    </span>
  </span>
);

/** An icon on its tone's tint: what a card, a row or a number is about, at a glance. */
export const IconTile: FC<{ icon: IconName; tone: Tone; class?: string }> = ({ icon, tone, class: className = 'h-10 w-10' }) => (
  <span aria-hidden="true" class={`grid shrink-0 place-items-center rounded-md ring-1 ring-inset ${TONE_SOFT[tone]} ${className}`}>
    <Icon name={icon} size={20} stroke={1.75} />
  </span>
);

/**
 * Who a row is about, as a letter: the first letter or digit of the name on a
 * neutral tile. No logo is ever fetched — nothing on a page comes from a third
 * party — and the tile takes no tone, because a tone here means a status.
 */
export const Avatar: FC<{ name: string }> = ({ name }) => (
  <span
    aria-hidden="true"
    class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-overlay text-entity text-ink-muted ring-1 ring-inset ring-line"
  >
    {[...name].find((ch) => /[\p{L}\p{N}]/u.test(ch))?.toUpperCase() ?? '?'}
  </span>
);

export const Hint: FC<PropsWithChildren<{ class?: string }>> = ({
  children,
  class: className = '',
}) => <p data-ui="hint" class={`text-meta text-ink-faint ${className}`}>{children}</p>;

/**
 * An empty state answers three questions: what is missing (`title`), why that
 * matters (the children, one sentence) and the one way forward (`action`, or
 * the sentence itself when the control is already on the page). `bare` is the
 * Empty inside a Card: the card is the surface, so no second outline.
 */
export const Empty: FC<PropsWithChildren<{ title: string; action?: Child; bare?: boolean }>> = ({
  title,
  action,
  bare = false,
  children,
}) => (
  <div
    class={`flex flex-col items-center justify-center gap-2 text-center ${
      bare ? 'px-4 py-8' : 'rounded-lg border border-line bg-surface-raised px-6 py-12 shadow-card'
    }`}
  >
    <span class="mb-1 grid h-10 w-10 place-items-center rounded-md bg-surface-overlay text-ink-faint">
      <Icon name="inbox" size={20} stroke={1.75} />
    </span>
    <div class="text-entity text-ink">{title}</div>
    <div class="max-w-md text-sm text-ink-muted">{children}</div>
    {action && <div class="mt-1.5">{action}</div>}
  </div>
);

export const Code: FC<PropsWithChildren> = ({ children }) => (
  <code class="rounded bg-surface-overlay px-1 py-0.5 font-mono text-[0.85em] text-ink">
    {children}
  </code>
);

/** Drawn check / x for verdict lists — never a Unicode glyph standing in for an icon. */
export const MarkIcon: FC<{ kind: 'check' | 'x'; class?: string }> = ({
  kind,
  class: className = '',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={`h-3.5 w-3.5 shrink-0 ${className}`}
    aria-hidden="true"
  >
    {kind === 'check' ? (
      <path d="M20 6 9 17l-5-5" />
    ) : (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    )}
  </svg>
);

/* ---------- disclosure, tabs, active filters ---------- */

const ChevronDown: FC = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-150 group-open:rotate-180"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const DISCLOSURE_SUMMARY = {
  button:
    'inline-flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-md border border-line-strong bg-surface-raised px-3.5 py-1.5 text-sm font-medium text-ink shadow-sm hover:bg-surface-overlay group-open:bg-surface-overlay',
  quiet: 'inline-flex items-center gap-1 text-note text-ink-muted hover:text-ink',
} as const;

/**
 * Native <details>: what is not needed at first glance folds away with no
 * JavaScript, and Enter / Space toggle it. `button` reads as a secondary
 * button (a toolbar's "Filters"); `quiet` is the muted line under a control
 * ("How this works"). `count` says how much is set inside while it is closed.
 * The children are the body — the caller lays them out, so a `contents`
 * disclosure can hand its body to the row it sits in.
 */
export const Disclosure: FC<
  PropsWithChildren<{
    summary: string;
    variant?: keyof typeof DISCLOSURE_SUMMARY;
    count?: number;
    open?: boolean;
    id?: string;
    class?: string;
  }>
> = ({ summary, variant = 'quiet', count = 0, open = false, id, class: className = '', children }) => (
  <details id={id} open={open} class={`group ${className}`}>
    <summary
      class={`cursor-pointer select-none list-none transition-colors duration-150 [&::-webkit-details-marker]:hidden ${DISCLOSURE_SUMMARY[variant]}`}
    >
      {summary}
      {count > 0 && (
        <span class="rounded bg-surface-selected px-1.5 text-meta font-medium tabular-nums text-accent-strong">
          {count}
          <span class="sr-only"> {t('ui.activeInside', { n: count })}</span>
        </span>
      )}
      <ChevronDown />
    </summary>
    {children}
  </details>
);

/**
 * The rest of an explanation, one press away (DESIGN.md, the Disclosure
 * Rule): under a label one sentence stays in sight, what else is worth
 * knowing folds here. Its prose carries the hint hook, so an open one counts.
 */
export const More: FC<PropsWithChildren<{ summary?: string; class?: string }>> = ({
  summary = t('ui.howThisWorks'),
  class: className = '',
  children,
}) => (
  <Disclosure variant="quiet" summary={summary} class={className}>
    <div data-ui="hint" class="mt-1 space-y-1 text-meta text-ink-faint">
      {children}
    </div>
  </Disclosure>
);

/**
 * A row of links to views of the same list, the current one underlined —
 * never a pill, so a tab does not read as a filter chip or a status badge.
 * A count is what the tab would show.
 */
export const Tabs: FC<{
  label: string;
  tabs: { href: string; label: string; count?: number; current: boolean }[];
  class?: string;
}> = ({ label, tabs, class: className = '' }) => (
  <nav aria-label={label} class={`flex flex-wrap gap-x-1 border-b border-line ${className}`}>
    {tabs.map((tab) => (
      <a
        href={tab.href}
        aria-current={tab.current ? 'page' : undefined}
        class={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-note transition-colors duration-150 ${
          tab.current
            ? 'border-accent-strong font-medium text-ink'
            : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink'
        }`}
      >
        {tab.label}
        {tab.count !== undefined && (
          <span class={`tabular-nums ${tab.current ? 'text-ink-muted' : 'text-ink-faint'}`}>
            {formatNumber(tab.count)}
          </span>
        )}
      </a>
    ))}
  </nav>
);

/**
 * One criterion in force, as a link that lifts it. Square-cornered and
 * emerald-tinted: not a status pill, not a tag, not an option to pick.
 */
export const FilterChip: FC<{ label: string; href: string; flag?: string }> = ({ label, href, flag }) => (
  <a
    href={href}
    aria-label={t('ui.removeFilter', { label })}
    class="inline-flex min-h-[28px] items-center gap-1.5 rounded-md border border-accent/30 bg-surface-selected py-0.5 pl-2 pr-1.5 text-note font-medium text-accent-strong transition-colors duration-150 hover:border-accent-strong"
  >
    {flag && <span aria-hidden="true">{flag}</span>}
    {label}
    <MarkIcon kind="x" class="!h-3 !w-3 opacity-70" />
  </a>
);

/**
 * One stored run in a row of them — a job's comparisons, its letters — as a
 * link to it. The one on screen is marked the way a chosen option is (DESIGN.md,
 * the Surface-First Rule): the selected surface, emerald-strong text at 500 and
 * a drawn check, never a tint alone. Meta inside it keeps its own weight with
 * `font-normal`, as a filter option's count does.
 */
export const HistoryChip: FC<PropsWithChildren<{ href: string; current: boolean }>> = ({ href, current, children }) => (
  <a
    href={href}
    aria-current={current ? 'true' : undefined}
    class={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-meta transition-colors duration-150 ${
      current
        ? 'border-accent/50 bg-surface-selected font-medium text-accent-strong'
        : 'border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:text-ink'
    }`}
  >
    {current && <MarkIcon kind="check" class="!h-3 !w-3" />}
    {children}
  </a>
);

/* ---------- data display ---------- */

/**
 * A fortnight as a row of bars, today last: the shape of a number's recent
 * days beside the number. Decorative — the delta line under the value says
 * the same thing in words — so it is hidden from a screen reader. A day with
 * nothing keeps a faint stub; the days fade towards the oldest.
 */
const SparkBars: FC<{ values: readonly number[]; tone: Tone; class?: string }> = ({ values, tone, class: className = '' }) => {
  const heights = barHeights(values);
  const last = Math.max(1, values.length - 1);
  return (
    <span aria-hidden="true" class={`flex h-10 shrink-0 items-end gap-[3px] ${className}`}>
      {heights.map((h, i) => (
        <span
          class={`w-1 rounded-full ${TONE_FILL[tone]}`}
          style={`height:${h}%;opacity:${(values[i] ?? 0) > 0 ? (0.45 + 0.55 * (i / last)).toFixed(2) : '0.18'}`}
        />
      ))}
    </span>
  );
};

/**
 * One number that stands alone: its icon on the tone's tint, the label, the
 * value at the KPI step and one line of what moved. With `href` the value is
 * a link stretched over the card; `spark` draws the last fortnight beside it
 * where there is room.
 */
export const StatCard: FC<{
  label: string;
  value: number;
  tone: Tone;
  icon: IconName;
  delta: Child;
  href?: string;
  /** What the link opens, for a screen reader: "open in Jobs". */
  hrefLabel?: string;
  spark?: readonly number[];
}> = ({ label, value, tone, icon, delta, href, hrefLabel, spark }) => (
  <div
    class={`relative flex gap-3.5 rounded-lg border border-line bg-surface-raised p-5 shadow-card transition-colors duration-150 ${
      href ? 'hover:border-line-strong' : ''
    }`}
  >
    <IconTile icon={icon} tone={tone} />
    <div class="min-w-0 flex-1">
      <div class="break-words text-label text-ink-muted">{label}</div>
      {/* The bars share the number's row and give way first: a narrow card clips the oldest days, never the number. */}
      <div class="mt-0.5 flex items-end justify-between gap-3">
        <div class="text-kpi tabular-nums text-ink">
          {href ? (
            <a href={href} class="after:absolute after:inset-0 after:rounded-lg hover:text-accent-strong">
              {formatNumber(value)}
              {hrefLabel && <span class="sr-only"> {label} — {hrefLabel}</span>}
            </a>
          ) : (
            formatNumber(value)
          )}
        </div>
        {spark && <SparkBars values={spark} tone={tone} class="min-w-0 justify-end overflow-hidden" />}
      </div>
      <div class="mt-1 text-note text-ink-faint">{delta}</div>
    </div>
  </div>
);

/** `md` is the pill that stands in a page header beside the buttons; `sm` is every other one. */
const BADGE_SIZE = {
  sm: 'px-2.5 py-0.5 text-meta',
  md: 'px-3 py-1.5 text-note',
} as const;

export const Badge: FC<PropsWithChildren<{ tone?: Tone; size?: keyof typeof BADGE_SIZE; class?: string }>> = ({
  children,
  tone = 'neutral',
  size = 'sm',
  class: className = '',
}) => (
  <span
    class={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset ${BADGE_SIZE[size]} ${TONE_SOFT[tone]} ${className}`}
  >
    {children}
  </span>
);

export const Tag: FC<PropsWithChildren<{ tone?: Tone }>> = ({
  children,
  tone = 'neutral',
}) => (
  <span
    class={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-meta font-medium ring-1 ring-inset ${TONE_SOFT[tone]}`}
  >
    {children}
  </span>
);

/** The word in its tone is the status; a pill needs no dot to say it twice. */
export const StatusBadge: FC<{ status: JobStatus }> = ({ status }) => (
  <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
);

/**
 * Fit score as a number in a toned tile: the number is the value, the tone its
 * floor (≥ 85 / ≥ 70 / ≥ 50 / under), so it reads without colour. `worded` adds
 * the floor's word ("72 Good") where there is room for it — a job page's
 * header, not a table cell.
 */
export const FitBadge: FC<{ score: number | null; label?: string; worded?: boolean }> = ({
  score,
  label = t('fit.label'),
  worded = false,
}) => {
  if (score == null) return <span class="text-ink-faint">—</span>;
  return (
    <span
      class={`inline-flex min-w-[2.25rem] items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-entity tabular-nums ring-1 ring-inset ${TONE_SOFT[fitTone(score)]}`}
      title={`${label} ${score}/100`}
    >
      {score}
      {worded && <span class="text-label">{fitWord(score)}</span>}
    </span>
  );
};

/* ---------- tables ---------- */

export const Table: FC<
  PropsWithChildren<{
    columns: (string | Child)[];
    stickyHeader?: boolean;
    /** Proportional column widths (`w-[34%]`, …) with table-fixed layout. */
    widths?: string[];
    /**
     * Per column, the breakpoint below which it leaves the table — header and
     * cells alike, from this one declaration (table-hide.ts, #77). '' keeps
     * a column always on.
     */
    hideBelow?: HideBelow;
    /** Per-column classes on the `th` itself (alignment and the like). */
    thClasses?: string[];
    /** What the table lists, for a screen reader's table list — no data table had a name (audit 2026-09-10, A11Y-3). */
    caption?: string;
  }>
> = ({ columns, stickyHeader = false, widths, hideBelow, thClasses, caption, children }) => {
  const table = (
    <table class={`w-full text-sm ${widths ? 'table-fixed' : ''} ${hideCellsClass(hideBelow)}`}>
      {caption && <caption class="sr-only">{caption}</caption>}
      <thead>
        <tr class="text-left text-label text-ink-muted">
          {columns.map((c, i) => (
            <th
              scope="col"
              class={`bg-surface-overlay/70 px-2.5 py-2.5 font-[550] first:rounded-tl-none first:pl-3.5 last:pr-3.5 sm:px-4 sm:first:pl-5 sm:last:pr-5 ${
                widths?.[i] ?? ''
              } ${hideHeaderClass(hideBelow, i)} ${thClasses?.[i] ?? ''} ${
                stickyHeader
                  ? 'sticky top-0 z-10 shadow-[inset_0_-1px_0_rgb(var(--line))]'
                  : 'border-b border-line'
              }`}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody class="divide-y divide-line">{children}</tbody>
    </table>
  );
  // A region that scrolls sideways takes a tab stop, so a keyboard can scroll it too (TASKS R20).
  return stickyHeader ? (
    table
  ) : (
    <div class="overflow-x-auto" tabindex={0} role="region" aria-label={caption ?? t('ui.table')}>
      {table}
    </div>
  );
};

export const Tr: FC<PropsWithChildren<Record<string, unknown> & { class?: string }>> = ({
  children,
  class: className = '',
  ...rest
}) => (
  <tr class={`transition-colors duration-150 hover:bg-surface-selected/50 ${className}`} {...rest}>
    {children}
  </tr>
);

export const Td: FC<PropsWithChildren<{ class?: string; title?: string }>> = ({
  children,
  class: className = '',
  title,
}) => (
  <td class={`px-2.5 py-3 first:pl-3.5 last:pr-3.5 sm:px-4 sm:first:pl-5 sm:last:pr-5 ${className}`} title={title}>
    {children}
  </td>
);

/* ---------- forms ---------- */

/**
 * Native file input styled to match the controls (shared by every upload form).
 * The button half is the FIRST action of any upload — the submit next to it
 * does nothing until a file is chosen — so it carries the accent and the
 * same size as a Button, not a 12 px grey chip (#155).
 */
export const FILE_INPUT_CLASS =
  'file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-accent/40 file:bg-accent/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-strong hover:file:bg-accent/15';

/**
 * Progressive enhancement for `form[data-needs-file]`: the submit waits,
 * disabled, until a file is chosen — it does nothing before that, and a solid
 * button that does nothing is what the eye went to first (#155). Inline in
 * the page, after the form; with JS off the button is simply enabled.
 */
export const NEEDS_FILE_JS =
  "document.querySelectorAll('form[data-needs-file]').forEach(function(f){" +
  "var b=f.querySelector('button:not([type]),button[type=submit]'),i=f.querySelector('input[type=file]');" +
  "if(!b||!i)return;b.disabled=!i.files.length;i.addEventListener('change',function(){b.disabled=!i.files.length})})";

/**
 * Label → one sentence → control. The <label> wraps only those, so a long
 * explanation never becomes the control's accessible name (audit A11Y-4):
 * `more` sits outside it, behind "How this works".
 */
export const Field: FC<PropsWithChildren<{ label: string; hint?: string; more?: Child; class?: string }>> = ({
  label,
  hint,
  more,
  children,
  class: className = '',
}) => (
  <div class={className}>
    <label class="block">
      <span class="block text-label text-ink">{label}</span>
      {hint && <Hint class="mt-0.5">{hint}</Hint>}
      <div class="mt-1.5">{children}</div>
    </label>
    {more && <More class="mt-1.5">{more}</More>}
  </div>
);

/* 36px tall with its border — the same height as a Button beside it. */
const CONTROL =
  'w-full rounded-md border border-line-strong bg-surface-raised px-3 py-[7px] text-sm text-ink placeholder:text-ink-faint shadow-sm transition-colors duration-150 hover:border-ink-faint focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent/25 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger/20';

export const Input: FC<Record<string, unknown> & { mono?: boolean }> = ({
  mono,
  class: className = '',
  ...rest
}) => <input class={`${CONTROL} ${mono ? 'font-mono text-meta' : ''} ${className}`} {...rest} />;

/* Drawn chevron so selects match the themed controls instead of browser chrome. */
const SELECT_CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23${hex(TOKENS['ink-faint']).slice(1)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export const Select: FC<PropsWithChildren<Record<string, unknown>>> = ({
  children,
  class: className = '',
  ...rest
}) => (
  <select
    class={`${CONTROL} appearance-none bg-[length:14px_14px] bg-[position:right_0.6rem_center] bg-no-repeat pr-8 ${className}`}
    style={`background-image:${SELECT_CHEVRON}`}
    {...rest}
  >
    {children}
  </select>
);

export const Textarea: FC<PropsWithChildren<Record<string, unknown> & { mono?: boolean }>> = ({
  children,
  mono,
  class: className = '',
  ...rest
}) => (
  <textarea class={`${CONTROL} ${mono ? 'font-mono text-meta' : ''} ${className}`} {...rest}>
    {children}
  </textarea>
);

export const Checkbox: FC<PropsWithChildren<Record<string, unknown>>> = ({
  children,
  ...rest
}) => (
  <label class="inline-flex min-h-[28px] cursor-pointer items-center gap-2 text-sm text-ink">
    <input type="checkbox" class="h-4 w-4 accent-accent" {...rest} />
    {children}
  </label>
);

/** Checkbox styled as a selectable pill — for option sets (seniority, regions, sources). */
export const PillCheckbox: FC<PropsWithChildren<Record<string, unknown>>> = ({
  children,
  ...rest
}) => (
  <label class="inline-flex min-h-[28px] cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-raised px-2.5 py-1 text-sm text-ink-muted transition-colors duration-150 hover:border-line-strong has-[:checked]:border-accent/40 has-[:checked]:bg-surface-selected has-[:checked]:text-ink">
    <input type="checkbox" class="h-3.5 w-3.5 accent-accent" {...rest} />
    {children}
  </label>
);

export const Radio: FC<PropsWithChildren<Record<string, unknown> & { title: Child }>> = ({
  children,
  title,
  ...rest
}) => (
  <label class="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface-raised p-3 text-sm text-ink transition-colors duration-150 hover:border-line-strong has-[:checked]:border-accent/50 has-[:checked]:bg-surface-selected">
    <input type="radio" class="mt-1 h-4 w-4 accent-accent" {...rest} />
    <span>
      <span class="font-medium">{title}</span>
      <span data-ui="hint" class="block text-meta text-ink-faint">{children}</span>
    </span>
  </label>
);

/* ---------- buttons ---------- */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warn' | 'violet' | 'ghost';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent-strong text-white shadow-sm hover:bg-accent-deep',
  secondary: 'border border-line-strong bg-surface-raised text-ink shadow-sm hover:bg-surface-overlay',
  // The word is red; the outline is any control's, so a column of Deletes does not shout.
  danger: 'border border-line-strong bg-surface-raised text-danger shadow-sm hover:border-danger/40 hover:bg-danger/5',
  warn: 'bg-warn text-white shadow-sm hover:bg-warn/90',
  violet: 'border border-violet/30 bg-violet/5 text-violet hover:bg-violet/10',
  ghost: 'text-ink-muted hover:bg-surface-overlay hover:text-ink',
};

/* Three heights: 30px in a table row, 36px beside a field, 40px for a page's main act. */
const BUTTON_SIZE = {
  sm: 'min-h-[30px] gap-1.5 px-2.5 py-1 text-note',
  md: 'min-h-[36px] gap-2 px-3.5 py-1.5 text-sm',
  lg: 'min-h-[40px] gap-2 px-4 py-2 text-sm',
} as const;

function buttonClass(variant: ButtonVariant, size: keyof typeof BUTTON_SIZE, extra = ''): string {
  return `inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${extra}`;
}

/**
 * A POST that deserves a second look — a delete, a spend — behind one more
 * press that needs no JavaScript (TASKS U8). The first press opens a native
 * popover (`popovertarget`) saying what will happen, with the real button in
 * it: the popover sits in the top layer, so a table's scroll box cannot clip
 * it, and Escape or a click outside closes it. `confirm()` in an onsubmit did
 * nothing without a script, and the delete went through.
 */
export const ConfirmAction: FC<{
  action: string;
  /** What the first button says. */
  label: string;
  /** What will happen, in one or two sentences. */
  confirm: string;
  /** The real button's words; the label when omitted. */
  yes?: string;
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZE;
  hidden?: Record<string, string | number>;
  /** On a wrapper around the button — alignment in a cell or a row. */
  class?: string;
  /** For a label that needs more than its words ("Delete" on a row). */
  ariaLabel?: string;
  disabled?: boolean;
}> = ({ action, label, confirm, yes, variant = 'danger', size = 'sm', hidden, class: extra, ariaLabel, disabled }) => {
  // The same action with the same fields is the same question, so one id per question on a page.
  const id = `confirm-${hashShortId(`${action}\n${label}\n${JSON.stringify(hidden ?? {})}`)}`;
  const parts = disabled ? (
    <button type="button" class={buttonClass(variant, size)} disabled>
      {label}
    </button>
  ) : (
    <>
      <button type="button" popovertarget={id} class={buttonClass(variant, size)} aria-label={ariaLabel}>
        {label}
      </button>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-label={ariaLabel ?? label}
        class="m-auto w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface-raised p-4 text-left text-note leading-5 text-ink shadow-pop backdrop:bg-[rgb(13_20_33/0.25)]"
      >
        <p>{confirm}</p>
        <form method="post" action={action} class="mt-3 flex justify-end gap-2">
          {hidden && Object.entries(hidden).map(([k, v]) => <input type="hidden" name={k} value={String(v)} />)}
          <Button type="button" variant="secondary" size="sm" popovertarget={id} popovertargetaction="hide" autofocus>
            {t('ui.cancel')}
          </Button>
          <Button variant={variant === 'ghost' ? 'danger' : variant} size="sm">
            {yes ?? label}
          </Button>
        </form>
      </div>
    </>
  );
  return extra ? <div class={extra}>{parts}</div> : parts;
};

export const Button: FC<
  PropsWithChildren<
    Record<string, unknown> & {
      variant?: ButtonVariant;
      size?: keyof typeof BUTTON_SIZE;
      href?: string;
    }
  >
> = ({ children, variant = 'primary', size = 'md', href, class: className = '', ...rest }) => {
  const cls = buttonClass(variant, size, className as string);
  if (href) {
    return (
      <a href={href} class={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button type="submit" class={cls} {...rest}>
      {children}
    </button>
  );
};

/**
 * `onsubmit` guard for a form whose POST starts real work — an upload, an AI
 * run. The redirect to the progress page is fast but not instant, and a
 * second click inside that window used to create a second resume and a
 * second AI call. Disabling after the submit event fired does not cancel the
 * submission, and with JS off the form still works as before.
 */
export const SUBMIT_ONCE =
  "if(this.dataset.sent)return false;this.dataset.sent='1';" +
  "this.querySelectorAll('button').forEach(function(b){b.disabled=true});";

/**
 * One-button POST form — the dashboard's main mutation idiom.
 *
 * A flex container, not a block: a block form wraps its inline-flex button in
 * a line box (button plus the font's descender), so a row that mixed a bare
 * Button with an ActionForm-wrapped one put them a few pixels apart (#153).
 * Block-level still, so stacked forms keep stacking.
 */
export const ActionForm: FC<
  PropsWithChildren<{
    action: string;
    hidden?: Record<string, string | number>;
    class?: string;
    /** Disable the buttons once pressed — for POSTs that start an AI run. */
    once?: boolean;
  }>
> = ({ action, hidden, children, class: className = '', once }) => (
  // A POST that wants a second look is ConfirmAction's, which needs no script (TASKS U8).
  <form method="post" action={action} class={`flex ${className}`} onsubmit={once ? SUBMIT_ONCE : undefined}>
    {hidden &&
      Object.entries(hidden).map(([k, v]) => <input type="hidden" name={k} value={String(v)} />)}
    {children}
  </form>
);

/**
 * An on/off setting: its label and one sentence on the left, a switch on the
 * right. The switch is a submit button with `role="switch"` in its own form,
 * so it works without a script; the label is wired to it, so a press on the
 * words flips it too, and the state is said in words beside the track, never
 * by its colour alone.
 */
export const ToggleRow: FC<
  PropsWithChildren<{
    label: string;
    enabled: boolean;
    action: string;
    /** The state in words: "On" / "Off" unless the setting has better ones ("Running" / "Paused"). */
    onLabel?: string;
    offLabel?: string;
    /** Fields the action needs besides the press itself. */
    hidden?: Record<string, string | number>;
    extra?: Child;
    /** What else is worth knowing, behind "How this works"; `children` stays one sentence. */
    more?: Child;
  }>
> = ({ label, enabled, action, onLabel = t('ui.on'), offLabel = t('ui.off'), hidden, extra, more, children }) => {
  const id = `switch${action.replace(/[^a-z0-9]+/gi, '-')}`;
  return (
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <label for={id} class="cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        <Hint class="mt-1">{children}</Hint>
        {more && <More class="mt-1">{more}</More>}
      </div>
      {/* Row, not column: a card with an `extra` action (Discovery's "Run now")
          keeps it beside the switch; they wrap only when the card is too narrow for both. */}
      <div class="flex shrink-0 flex-wrap items-center justify-end gap-3">
        {extra}
        <ActionForm action={action} hidden={hidden}>
          <button
            type="submit"
            id={id}
            role="switch"
            aria-checked={enabled ? 'true' : 'false'}
            class="group inline-flex min-h-[32px] cursor-pointer items-center gap-2 rounded-full"
          >
            <span class="text-note font-medium text-ink-muted">{enabled ? onLabel : offLabel}</span>
            <span
              aria-hidden="true"
              class={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 ${
                enabled ? 'bg-ok' : 'bg-line-strong'
              }`}
            >
              <span
                class={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                  enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </ActionForm>
      </div>
    </div>
  );
};

/**
 * Newline-joined list in a textarea — the transport the backend already
 * parses. chips.mjs upgrades it into a chip editor; without JS the plain
 * textarea still works.
 */
export const TagListInput: FC<{
  label: string;
  hint?: string;
  more?: Child;
  name: string;
  values: string[];
  rows?: number;
  /** Real example values — shown in the textarea and the chip input alike. */
  placeholder?: string;
  /** "countries": countries.mjs adds gazetteer suggestions to the chip input (ADR 0032). */
  picker?: 'countries';
}> = ({ label, hint, more, name, values, rows = 3, placeholder, picker }) => (
  <Field label={label} hint={hint} more={more}>
    <div data-chips data-label={label} data-placeholder={placeholder} data-picker={picker}>
      <Textarea name={name} rows={rows} mono placeholder={placeholder}>
        {values.join('\n')}
      </Textarea>
    </div>
  </Field>
);
