/** @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { fitTone, statusLabel, statusTone, type Tone } from './format';
import type { FlashKind, FlashMessage } from './flash';

/*
 * Shared primitives. Every page composes these instead of writing raw
 * Tailwind strings, so colour and spacing decisions live in one file.
 * Tones map to the semantic tokens declared in layout.tsx.
 */

const TONE_SOFT: Record<Tone, string> = {
  ok: 'bg-ok/10 text-ok ring-ok/20',
  warn: 'bg-warn/10 text-warn ring-warn/20',
  danger: 'bg-danger/10 text-danger ring-danger/20',
  info: 'bg-info/10 text-info ring-info/20',
  violet: 'bg-violet/10 text-violet ring-violet/20',
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
      <h1 class="min-w-0 truncate text-xl font-semibold tracking-tight" title={title}>
        {title}
      </h1>
      {(meta || actions) && (
        <div class="flex min-w-0 flex-wrap items-center gap-3">
          {meta && <div class="text-[13px] text-ink-faint tabular-nums">{meta}</div>}
          {actions}
        </div>
      )}
    </div>
    {children && (
      <div class="mt-1.5 text-[13px] leading-5 text-ink-faint">{children}</div>
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

export const Card: FC<PropsWithChildren<{ class?: string; flush?: boolean; id?: string }>> = ({
  children,
  class: className = '',
  flush = false,
  id,
}) => (
  <section
    id={id}
    class={`rounded-lg border border-line bg-surface-raised shadow-sm ${
      flush ? 'overflow-hidden' : 'p-5'
    } ${className}`}
  >
    {children}
  </section>
);

export const SectionTitle: FC<PropsWithChildren> = ({ children }) => (
  <h2 class="mb-3 text-sm font-semibold text-ink">{children}</h2>
);

export const Hint: FC<PropsWithChildren<{ class?: string }>> = ({
  children,
  class: className = '',
}) => <p class={`text-[13px] leading-5 text-ink-faint ${className}`}>{children}</p>;

export const Empty: FC<PropsWithChildren> = ({ children }) => (
  <div class="flex flex-col items-center justify-center gap-2.5 rounded-lg border border-line bg-surface-raised px-6 py-12 text-center">
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
    <div class="max-w-md text-sm text-ink-faint">{children}</div>
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

/* ---------- data display ---------- */

export const Stat: FC<{
  label: string | Child;
  value: string | number;
  tone?: Tone;
  sub?: Child;
  muted?: boolean;
}> = ({ label, value, tone, sub, muted = false }) => (
  <div
    class={`rounded-lg border bg-surface-raised p-4 ${
      muted ? 'border-line/70' : 'border-line shadow-sm'
    }`}
  >
    <div class={`text-[13px] font-medium ${muted ? 'text-ink-faint' : 'text-ink-muted'}`}>
      {label}
    </div>
    <div
      class={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${
        tone ? TONE_TEXT[tone] : muted ? 'text-ink-muted' : 'text-ink'
      }`}
    >
      {value}
    </div>
    {sub && <div class="mt-1 text-xs text-ink-faint">{sub}</div>}
  </div>
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

/** Fit score as number + meter, so the value reads without colour. */
export const FitBadge: FC<{ score: number | null; label?: string }> = ({ score, label = 'fit' }) => {
  if (score == null) return <span class="text-ink-faint">—</span>;
  const tone = fitTone(score);
  return (
    <span
      class="inline-flex items-center gap-1.5 whitespace-nowrap"
      title={`${label} ${score}/100`}
    >
      <span class={`text-sm font-medium tabular-nums ${TONE_TEXT[tone]}`}>{score}</span>
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
     * Per-column classes on the `th` itself — the only place a responsive
     * `hidden sm:table-cell` can live, since a class on the label inside
     * still leaves the cell occupying its column. Pair each entry with the
     * same class on that column's `Td`.
     */
    thClasses?: string[];
  }>
> = ({ columns, stickyHeader = false, widths, thClasses, children }) => {
  const table = (
    <table class={`w-full text-sm ${widths ? 'table-fixed' : ''}`}>
      <thead>
        <tr class="text-left text-xs font-medium text-ink-muted">
          {columns.map((c, i) => (
            <th
              scope="col"
              class={`bg-surface-overlay px-2.5 py-2.5 font-medium first:rounded-tl-none first:pl-3.5 last:pr-3.5 sm:px-4 sm:first:pl-5 sm:last:pr-5 ${
                widths?.[i] ?? ''
              } ${thClasses?.[i] ?? ''} ${
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

export const Tr: FC<PropsWithChildren<{ class?: string }>> = ({
  children,
  class: className = '',
}) => (
  <tr class={`transition-colors duration-150 hover:bg-surface-overlay/50 ${className}`}>
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

/** Native file input styled to match the controls (shared by every upload form). */
export const FILE_INPUT_CLASS =
  'file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-overlay file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-ink';

export const Field: FC<PropsWithChildren<{ label: string; hint?: string; class?: string }>> = ({
  label,
  hint,
  children,
  class: className = '',
}) => (
  <label class={`block ${className}`}>
    <span class="block text-[13px] font-medium text-ink">{label}</span>
    {hint && <Hint class="mt-0.5">{hint}</Hint>}
    <div class="mt-1.5">{children}</div>
  </label>
);

const CONTROL =
  'w-full rounded-md border border-line-strong bg-surface-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint shadow-sm transition-colors duration-150 hover:border-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15';

export const Input: FC<Record<string, unknown> & { mono?: boolean }> = ({
  mono,
  class: className = '',
  ...rest
}) => <input class={`${CONTROL} ${mono ? 'font-mono text-xs' : ''} ${className}`} {...rest} />;

/* Drawn chevron so selects match the themed controls instead of browser chrome. */
const SELECT_CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

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
  <label class="inline-flex min-h-[28px] cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-raised px-2.5 py-1 text-sm text-ink-muted transition-colors duration-150 hover:border-line-strong has-[:checked]:border-accent/40 has-[:checked]:bg-accent/5 has-[:checked]:text-ink">
    <input type="checkbox" class="h-3.5 w-3.5 accent-accent" {...rest} />
    {children}
  </label>
);

export const Radio: FC<PropsWithChildren<Record<string, unknown> & { title: Child }>> = ({
  children,
  title,
  ...rest
}) => (
  <label class="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface-raised p-3 text-sm text-ink transition-colors duration-150 hover:border-line-strong has-[:checked]:border-accent/50 has-[:checked]:bg-accent/5">
    <input type="radio" class="mt-1 h-4 w-4 accent-accent" {...rest} />
    <span>
      <span class="font-medium">{title}</span>
      <span class="block text-[13px] leading-5 text-ink-faint">{children}</span>
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
