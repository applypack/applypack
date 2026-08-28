/** @jsxImportSource hono/jsx */
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { JobStatus } from '@prisma/client';
import { fitTone, statusTone, type Tone } from './format';

/*
 * Shared primitives. Every page composes these instead of writing raw
 * Tailwind strings, so colour and spacing decisions live in one file.
 * Tones map to the semantic tokens declared in layout.tsx.
 */

const TONE_SOFT: Record<Tone, string> = {
  ok: 'bg-ok/10 text-ok ring-ok/25',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  danger: 'bg-danger/10 text-danger ring-danger/25',
  info: 'bg-info/10 text-info ring-info/25',
  violet: 'bg-violet/10 text-violet ring-violet/25',
  neutral: 'bg-ink/5 text-ink-muted ring-line-strong',
};

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  violet: 'text-violet',
  neutral: 'text-ink-faint',
};

/* ---------- page scaffolding ---------- */

export const PageHeader: FC<
  PropsWithChildren<{ title: string; meta?: string | Child }>
> = ({ title, meta, children }) => (
  <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
    {meta && <div class="text-sm text-ink-faint tabular-nums">{meta}</div>}
  </div>
);

export const Flash: FC<{
  flash?: { kind: 'ok' | 'err'; text: string } | null;
}> = ({ flash }) =>
  flash ? (
    <div
      role="status"
      class={`mb-4 rounded-md px-4 py-2 text-sm ring-1 ring-inset ${
        flash.kind === 'ok' ? TONE_SOFT.ok : TONE_SOFT.danger
      }`}
    >
      {flash.text}
    </div>
  ) : null;

export const Card: FC<PropsWithChildren<{ class?: string; flush?: boolean }>> = ({
  children,
  class: className = '',
  flush = false,
}) => (
  <section
    class={`rounded-lg border border-line bg-surface-raised ${
      flush ? 'overflow-hidden' : 'p-5'
    } ${className}`}
  >
    {children}
  </section>
);

export const SectionTitle: FC<PropsWithChildren> = ({ children }) => (
  <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
    {children}
  </h2>
);

export const Hint: FC<PropsWithChildren<{ class?: string }>> = ({
  children,
  class: className = '',
}) => <p class={`text-xs leading-5 text-ink-faint ${className}`}>{children}</p>;

export const Empty: FC<PropsWithChildren> = ({ children }) => (
  <div class="rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-ink-faint">
    {children}
  </div>
);

export const Code: FC<PropsWithChildren> = ({ children }) => (
  <code class="rounded bg-surface-overlay px-1 py-0.5 font-mono text-[0.85em] text-ink">
    {children}
  </code>
);

/* ---------- data display ---------- */

export const Stat: FC<{ label: string; value: string | number; tone?: Tone }> = ({
  label,
  value,
  tone,
}) => (
  <div class="rounded-lg border border-line bg-surface-raised p-4">
    <div class="text-xs uppercase tracking-wider text-ink-faint">{label}</div>
    <div
      class={`mt-1 font-mono text-2xl font-medium tabular-nums ${
        tone ? TONE_TEXT[tone] : 'text-ink'
      }`}
    >
      {value}
    </div>
  </div>
);

export const Badge: FC<PropsWithChildren<{ tone?: Tone; class?: string }>> = ({
  children,
  tone = 'neutral',
  class: className = '',
}) => (
  <span
    class={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_SOFT[tone]} ${className}`}
  >
    {children}
  </span>
);

export const Tag: FC<PropsWithChildren<{ tone?: Tone }>> = ({
  children,
  tone = 'neutral',
}) => (
  <span
    class={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-xs ring-1 ring-inset ${TONE_SOFT[tone]}`}
  >
    {children}
  </span>
);

export const StatusBadge: FC<{ status: JobStatus }> = ({ status }) => (
  <Badge tone={statusTone(status)}>{status}</Badge>
);

/** Fit score as number + 4-step meter, so the value reads without colour. */
export const FitBadge: FC<{ score: number | null; label?: string }> = ({ score, label = 'fit' }) => {
  if (score == null) return <span class="text-ink-faint">—</span>;
  const tone = fitTone(score);
  const filled = score >= 85 ? 4 : score >= 70 ? 3 : score >= 50 ? 2 : 1;
  return (
    <span
      class={`inline-flex items-center gap-1.5 font-mono text-sm font-medium tabular-nums ${TONE_TEXT[tone]}`}
      title={`${label} ${score}/100`}
    >
      {score}
      <span class="flex gap-px" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span
            class={`h-3 w-1 rounded-sm ${i <= filled ? 'bg-current' : 'bg-line-strong'}`}
          />
        ))}
      </span>
    </span>
  );
};

/* ---------- tables ---------- */

export const Table: FC<PropsWithChildren<{ columns: (string | Child)[] }>> = ({
  columns,
  children,
}) => (
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-line text-left text-xs uppercase tracking-wider text-ink-faint">
          {columns.map((c) => (
            <th scope="col" class="px-4 py-2.5 font-medium first:pl-5 last:pr-5">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody class="divide-y divide-line">{children}</tbody>
    </table>
  </div>
);

export const Tr: FC<PropsWithChildren<{ class?: string }>> = ({
  children,
  class: className = '',
}) => (
  <tr class={`transition-colors duration-150 hover:bg-surface-overlay/60 ${className}`}>
    {children}
  </tr>
);

export const Td: FC<PropsWithChildren<{ class?: string; title?: string }>> = ({
  children,
  class: className = '',
  title,
}) => (
  <td class={`px-4 py-2.5 first:pl-5 last:pr-5 ${className}`} title={title}>
    {children}
  </td>
);

/* ---------- forms ---------- */

export const Field: FC<PropsWithChildren<{ label: string; hint?: string; class?: string }>> = ({
  label,
  hint,
  children,
  class: className = '',
}) => (
  <label class={`block ${className}`}>
    <span class="block text-xs uppercase tracking-wider text-ink-faint">{label}</span>
    {hint && <Hint class="mt-1">{hint}</Hint>}
    <div class="mt-1">{children}</div>
  </label>
);

const CONTROL =
  'w-full rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink placeholder-ink-faint transition-colors duration-150 hover:border-ink-faint focus:border-accent focus:outline-none';

export const Input: FC<Record<string, unknown> & { mono?: boolean }> = ({
  mono,
  class: className = '',
  ...rest
}) => <input class={`${CONTROL} ${mono ? 'font-mono text-xs' : ''} ${className}`} {...rest} />;

export const Select: FC<PropsWithChildren<Record<string, unknown>>> = ({
  children,
  class: className = '',
  ...rest
}) => (
  <select class={`${CONTROL} ${className}`} {...rest}>
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
    <input
      type="checkbox"
      class="h-4 w-4 rounded border-line-strong bg-surface text-accent focus:ring-accent"
      {...rest}
    />
    {children}
  </label>
);

export const Radio: FC<PropsWithChildren<Record<string, unknown> & { title: string }>> = ({
  children,
  title,
  ...rest
}) => (
  <label class="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3 text-sm text-ink transition-colors duration-150 hover:border-line-strong has-[:checked]:border-accent/60 has-[:checked]:bg-accent/5">
    <input type="radio" class="mt-1 text-accent focus:ring-accent" {...rest} />
    <span>
      <span class="font-medium">{title}</span>
      <span class="block text-xs leading-5 text-ink-faint">{children}</span>
    </span>
  </label>
);

/* ---------- buttons ---------- */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warn' | 'violet' | 'ghost';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent-strong text-surface hover:bg-accent',
  secondary: 'border border-line-strong text-ink hover:bg-surface-overlay',
  danger: 'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
  warn: 'bg-warn text-surface hover:bg-warn/90',
  violet: 'border border-violet/40 bg-violet/10 text-violet hover:bg-violet/20',
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

/** One-button POST form — the dashboard's main mutation idiom. */
export const ActionForm: FC<
  PropsWithChildren<{
    action: string;
    confirm?: string;
    hidden?: Record<string, string | number>;
    class?: string;
  }>
> = ({ action, confirm, hidden, children, class: className = '' }) => (
  <form
    method="post"
    action={action}
    class={className}
    onsubmit={confirm ? `return confirm(${JSON.stringify(confirm)});` : undefined}
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
        <span class="text-ink-muted">{label}</span>
        <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? onLabel : offLabel}</Badge>
      </div>
      <Hint class="mt-1 max-w-prose">{children}</Hint>
    </div>
    <div class="flex shrink-0 flex-col items-end gap-2">
      <ActionForm action={action}>
        <Button variant={enabled ? 'secondary' : 'primary'} size="lg">
          {enabled ? disableText : enableText}
        </Button>
      </ActionForm>
      {extra}
    </div>
  </div>
);
