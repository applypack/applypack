/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { CheckState, SummaryGuide } from '../../resume/summary-guide';
import type { Tone } from '../format';
import { Hint, inEnglish, TONE_TEXT } from '../ui';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

/** The mark a check carries, and the word a screen reader hears in its place ("In place:"), as a catalog key. */
const MARK = {
  ok: { glyph: '✓', tone: 'ok', said: 'summary.mark.ok' },
  todo: { glyph: '○', tone: 'neutral', said: 'summary.mark.todo' },
  warn: { glyph: '!', tone: 'warn', said: 'summary.mark.warn' },
} as const satisfies Record<CheckState, { glyph: string; tone: Tone; said: MessageKey }>;

/**
 * "What this reader looks for in a summary" (summary-guide.ts): the brief's
 * first reader and what they scan for, then one line per check against the
 * summary the comparison read. It sits at the head of the summary section, so
 * a suggested summary arrives under the list it was written to, and a resume
 * the comparison owes no summary edit still sees how its own one reads.
 */
export const SummaryGuideBlock: FC<{ guide: SummaryGuide }> = ({ guide }) => {
  const done = guide.checks.filter((c) => c.state === 'ok').length;
  return (
    <div class="mb-2 rounded-md border border-line px-3 py-2.5">
      <div class="flex flex-wrap items-baseline gap-x-2">
        <span class="text-label text-ink">{t('summary.heading')}</span>
        <span class="text-meta text-ink-faint">
          {guide.proposed === null
            ? t('summary.tally', { done, total: guide.checks.length })
            : t('summary.tallyProposed', { done, total: guide.checks.length, proposed: guide.proposed })}
        </span>
      </div>
      {guide.reader && (
        // Who reads first and what they scan for are the posting brief's own words, in the English the model wrote.
        <Hint class="mt-0.5">
          {guide.scanFor.length > 0
            ? tRich('summary.readerScans', { reader: guide.reader, list: guide.scanFor.join(' · ') }, { en: inEnglish })
            : tRich('summary.reader', { reader: guide.reader }, { en: inEnglish })}
        </Hint>
      )}
      <ul class="mt-2 space-y-1 text-meta">
        {guide.checks.map((c) => (
          <li class="flex gap-2">
            <span aria-hidden="true" class={`w-3 shrink-0 text-center font-semibold ${TONE_TEXT[MARK[c.state].tone]}`}>
              {MARK[c.state].glyph}
            </span>
            <span class="min-w-0">
              <span class="sr-only">{t(MARK[c.state].said)} </span>
              <span class="font-medium text-ink">{c.label}</span>
              <span class="text-ink-muted"> · {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
