/** @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { fitTone, fitWord, statusLabel, statusTone, type Tone } from './format';
import type { FlashKind, FlashMessage } from './flash';
import { hideCellsClass, hideHeaderClass, type HideBelow } from './table-hide';
import { TOKENS, hex } from './tokens';

/*
 * Shared primitives. Every page composes these instead of writing raw
 * Tailwind strings, so colour and spacing decisions live in one file.
 * Tones map to the semantic tokens valued in tokens.ts.
 */

/*
 * A pill paints its 10 % tint over white whatever it is laid on (the gradient
 * is the tint, the colour under it the ground), so its text contrast is one
 * number held by tokens.test.ts — not one per surface. On the canvas alone the
 * bare tint read 4.44:1 for the Applied pill. The ground is a `pill-*` class
 * from src/web/tailwind.css: written out as an arbitrary value it cost 80
 * bytes a pill, 8 KB on a resume page with a hundred skill tags.
 */
const TONE_SOFT: Record<Tone, string> = {
  ok: 'pill-ok text-ok ring-ok/20',
  warn: 'pill-warn text-warn ring-warn/20',
  danger: 'pill-danger text-danger ring-danger/20',
  info: 'pill-info text-info ring-info/20',
  violet: 'pill-violet text-violet ring-violet/20',
  neutral: 'bg-surface-overlay text-ink-muted ring-line',
};

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  violet: 'text-violet',
  neutral: 'text-ink-faint',
};

const TONE_FILL: Record<Tone, string> = {
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
    back?: { href: string; label: string };
  }>
> = ({ title, meta, actions, back, children }) => (
  <header class="mb-6 shrink-0">
    {back && (
      <a
        href={back.href}
        class="mb-1.5 inline-flex items-center gap-1 text-[13px] text-ink-faint transition-colors duration-150 hover:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        {back.label}
      </a>
    )}
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h1 class="min-w-0 truncate text-title text-ink" title={title}>
        {title}
      </h1>
      {(meta || actions) && (
        <div class="flex min-w-0 flex-wrap items-center gap-3">
          {meta && <div data-ui="hint" class="text-meta text-ink-faint tabular-nums">{meta}</div>}
          {actions}
        </div>
      )}
    </div>
    {children && (
      <div data-ui="hint" class="mt-1.5 text-sm leading-5 text-ink-muted">{children}</div>
    )}
  </header>
);

const FLASH_TONE: Record<FlashKind, string> = {
  ok: 'border-ok/25 bg-ok/5 text-ok',
  warn: 'border-warn/25 bg-warn/5 text-warn',
  err: 'border-danger/25 bg-danger/5 text-danger',
};

/** `children` is the message's one action, if any — a form or a button after the text. */
export const Flash: FC<PropsWithChildren<{ flash?: FlashMessage | null }>> = ({ flash, children }) =>
  flash ? (
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
      <span class="min-w-0 flex-1">{flash.text}</span>
      {children}
    </div>
  ) : null;

const CARD_VARIANT = {
  /** An object that stands alone: raised, outlined, a whisper of shadow. */
  card: 'rounded-lg border border-line bg-surface-raised shadow-sm',
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
      bare ? 'px-4 py-8' : 'rounded-lg border border-line bg-surface-raised px-6 py-12'
    }`}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="h-7 w-7 text-line-strong"
      aria-hidden="true"
    >
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
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
    'inline-flex min-h-[32px] items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-surface-raised px-3 py-1.5 text-sm font-medium text-ink shadow-sm hover:bg-surface-overlay group-open:bg-surface-overlay',
  quiet: 'inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink',
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
        <span class="rounded bg-surface-selected px-1.5 text-xs font-medium tabular-nums text-accent-strong">
          {count}
          <span class="sr-only"> active</span>
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
  summary = 'How this works',
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
    {tabs.map((t) => (
      <a
        href={t.href}
        aria-current={t.current ? 'page' : undefined}
        class={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] transition-colors duration-150 ${
          t.current
            ? 'border-accent-strong font-medium text-ink'
            : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink'
        }`}
      >
        {t.label}
        {t.count !== undefined && (
          <span class={`tabular-nums ${t.current ? 'text-ink-muted' : 'text-ink-faint'}`}>
            {t.count.toLocaleString()}
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
    aria-label={`Remove filter: ${label}`}
    class="inline-flex min-h-[28px] items-center gap-1.5 rounded-md border border-accent/30 bg-surface-selected py-0.5 pl-2 pr-1.5 text-[13px] font-medium text-accent-strong transition-colors duration-150 hover:border-accent-strong"
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
    class={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors duration-150 ${
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
 * A few numbers read as one line: a <dl> on one raised surface, the cells
 * divided by hairlines rather than boxed apart. Each cell is a dot and a
 * label, a 28 px tabular value and a delta line; with `href` the value is a
 * link stretched over its cell. Two columns on a narrow screen, one row of
 * four from xl.
 */
export const MetricStrip: FC<{
  label: string;
  cells: { label: string; value: number; tone: Tone; delta: Child; href?: string }[];
  footer?: Child;
}> = ({ label, cells, footer }) => (
  <section aria-label={label} class="overflow-hidden rounded-lg border border-line bg-surface-raised shadow-sm">
    <dl class="grid grid-cols-2 xl:grid-cols-4">
      {cells.map((cell, i) => (
        <div
          class={`relative border-line px-5 py-4 transition-colors duration-150 ${cell.href ? 'hover:bg-surface-selected/50' : ''} ${
            i % 2 === 1 ? 'border-l' : i > 0 ? 'xl:border-l' : ''
          } ${i >= 2 ? 'border-t xl:border-t-0' : ''}`}
        >
          <dt class="flex items-center gap-1.5 text-label text-ink-muted">
            <span class={`h-1.5 w-1.5 rounded-full ${TONE_FILL[cell.tone]}`} aria-hidden="true" />
            {cell.label}
          </dt>
          <dd class="mt-1 text-[28px] font-semibold leading-8 tracking-tight tabular-nums text-ink">
            {cell.href ? (
              <a href={cell.href} class="after:absolute after:inset-0 hover:text-accent-strong">
                {cell.value.toLocaleString()}
                <span class="sr-only"> {cell.label} — open in Jobs</span>
              </a>
            ) : (
              cell.value.toLocaleString()
            )}
          </dd>
          <dd class="mt-0.5 text-meta text-ink-faint">{cell.delta}</dd>
        </div>
      ))}
    </dl>
    {footer && (
      <div data-ui="hint" class="border-t border-line px-5 py-2.5 text-meta tabular-nums text-ink-faint">
        {footer}
      </div>
    )}
  </section>
);

export const Badge: FC<PropsWithChildren<{ tone?: Tone; class?: string }>> = ({
  children,
  tone = 'neutral',
  class: className = '',
}) => (
  <span
    class={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_SOFT[tone]} ${className}`}
  >
    {children}
  </span>
);

export const Tag: FC<PropsWithChildren<{ tone?: Tone }>> = ({
  children,
  tone = 'neutral',
}) => (
  <span
    class={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs ring-1 ring-inset ${TONE_SOFT[tone]}`}
  >
    {children}
  </span>
);

export const StatusBadge: FC<{ status: JobStatus }> = ({ status }) => (
  <Badge tone={statusTone(status)}>
    <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
    {statusLabel(status)}
  </Badge>
);

/**
 * Fit score as number + meter, so the value reads without colour. `worded`
 * adds the floor's word ("72 Good") where there is room for it — a job page's
 * header, not a table cell.
 */
export const FitBadge: FC<{ score: number | null; label?: string; worded?: boolean }> = ({
  score,
  label = 'fit',
  worded = false,
}) => {
  if (score == null) return <span class="text-ink-faint">—</span>;
  const tone = fitTone(score);
  return (
    <span
      class="inline-flex items-center gap-1.5 whitespace-nowrap"
      title={`${label} ${score}/100`}
    >
      <span class={`text-sm font-medium tabular-nums ${TONE_TEXT[tone]}`}>
        {score}
        {worded && <span class="ml-1.5">{fitWord(score)}</span>}
      </span>
      <span class="h-1.5 w-9 shrink-0 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <span
          class={`block h-full rounded-full ${TONE_FILL[tone]}`}
          style={`width:${Math.max(4, Math.min(100, score))}%`}
        />
      </span>
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
              class={`bg-surface-overlay px-2.5 py-2.5 font-[550] first:rounded-tl-none first:pl-3.5 last:pr-3.5 sm:px-4 sm:first:pl-5 sm:last:pr-5 ${
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
  return stickyHeader ? table : <div class="overflow-x-auto">{table}</div>;
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

const CONTROL =
  'w-full rounded-md border border-line-strong bg-surface-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint shadow-sm transition-colors duration-150 hover:border-ink-faint focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent/25';

export const Input: FC<Record<string, unknown> & { mono?: boolean }> = ({
  mono,
  class: className = '',
  ...rest
}) => <input class={`${CONTROL} ${mono ? 'font-mono text-xs' : ''} ${className}`} {...rest} />;

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
  <textarea class={`${CONTROL} ${mono ? 'font-mono text-xs' : ''} ${className}`} {...rest}>
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
  danger: 'border border-danger/30 bg-surface-raised text-danger shadow-sm hover:bg-danger/5',
  warn: 'bg-warn text-white shadow-sm hover:bg-warn/90',
  violet: 'border border-violet/30 bg-violet/5 text-violet hover:bg-violet/10',
  ghost: 'text-ink-muted hover:bg-surface-overlay hover:text-ink',
};

const BUTTON_SIZE = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-sm',
} as const;

export const Button: FC<
  PropsWithChildren<
    Record<string, unknown> & {
      variant?: ButtonVariant;
      size?: keyof typeof BUTTON_SIZE;
      href?: string;
    }
  >
> = ({ children, variant = 'primary', size = 'md', href, class: className = '', ...rest }) => {
  const cls = `inline-flex min-h-[32px] cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`;
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
    confirm?: string;
    hidden?: Record<string, string | number>;
    class?: string;
    /** Disable the buttons once pressed — for POSTs that start an AI run. */
    once?: boolean;
  }>
> = ({ action, confirm, hidden, children, class: className = '', once }) => (
  <form
    method="post"
    action={action}
    class={`flex ${className}`}
    onsubmit={
      [confirm ? `if(!confirm(${JSON.stringify(confirm)}))return false;` : '', once ? SUBMIT_ONCE : '']
        .join('') || undefined
    }
  >
    {hidden &&
      Object.entries(hidden).map(([k, v]) => <input type="hidden" name={k} value={String(v)} />)}
    {children}
  </form>
);

/** Status line + toggle button, used by every on/off card on /settings. */
export const ToggleRow: FC<
  PropsWithChildren<{
    label: string;
    enabled: boolean;
    action: string;
    onLabel?: string;
    offLabel?: string;
    enableText?: string;
    disableText?: string;
    extra?: Child;
    /** What else is worth knowing, behind "How this works"; `children` stays one sentence. */
    more?: Child;
  }>
> = ({
  label,
  enabled,
  action,
  onLabel = 'Enabled',
  offLabel = 'Disabled',
  enableText = 'Enable',
  disableText = 'Disable',
  extra,
  more,
  children,
}) => (
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2 text-sm">
        <span class="font-medium text-ink">{label}</span>
        <Badge tone={enabled ? 'ok' : 'neutral'}>
          <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {enabled ? onLabel : offLabel}
        </Badge>
      </div>
      <Hint class="mt-1">{children}</Hint>
      {more && <More class="mt-1">{more}</More>}
    </div>
    {/* Row, not column: a card with an `extra` action (Discovery's "Run now")
        stacked its two buttons vertically, which read as one button dropped
        below the other. They wrap only when the card is too narrow for both. */}
    <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <ActionForm action={action}>
        <Button variant={enabled ? 'secondary' : 'primary'}>
          {enabled ? disableText : enableText}
        </Button>
      </ActionForm>
      {extra}
    </div>
  </div>
);

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
