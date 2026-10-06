/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Hint, PageHeader } from '../ui';
import { describeRefresh, type PreviewRow, type RefreshPlan } from '../../jobs/description-diff';
import { jobHref } from '../job-tabs';
import { safeHref } from '../format';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

/*
 * The confirmation behind "Refresh the description from the company's
 * listing" (#162 stage 3, ADR 0043): what the page holds against what is
 * stored, line by line, before anything is written. The listing's text
 * travels in the form so what was shown is what gets written, even if the
 * page changes in between.
 */

export interface DescriptionRefreshProps {
  job: { id: number; title: string; companyName: string };
  url: string;
  plan: RefreshPlan;
  rows: PreviewRow[];
  text: string;
}

const ROW_CLASS: Record<Exclude<PreviewRow['kind'], 'fold'>, string> = {
  keep: 'text-ink-faint',
  delete: 'bg-danger/10 text-danger line-through decoration-danger/40',
  insert: 'bg-ok/10 text-ink',
};
const ROW_MARK: Record<Exclude<PreviewRow['kind'], 'fold'>, string> = { keep: ' ', delete: '−', insert: '+' };

export const DescriptionRefreshPage: FC<DescriptionRefreshProps> = ({ job, url, plan, rows, text }) => {
  const back = jobHref(job.id, 'verify', {}, 'verification');
  return (
    <Layout title={t('description.refreshTheDescription')} active="jobs">
      <PageHeader
        title={t('description.refreshTheDescription')}
        meta={
          <span translate="no">
            {job.title} · {job.companyName}
          </span>
        }
        back={{ href: back, label: t('job.backToTheJob') }}
      />
      <Card>
        <p class="text-sm leading-6 text-ink">
          {tRich('description.reads', { summary: describeRefresh(plan) }, {
            url: () =>
              safeHref(url) ? (
                <a
                  href={safeHref(url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="break-all font-mono text-meta text-accent-strong hover:text-accent-deep"
                  translate="no"
                >
                  {url.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                <span class="break-all font-mono text-meta" translate="no">
                  {url}
                </span>
              ),
          })}
        </p>
        {!plan.mentionsTitle && (
          <Hint class="mt-2">
            {t('description.noTitle', { title: job.title })}
          </Hint>
        )}
        <Hint class="mt-2">
          {t('description.replacingKeepsTheStoredText')}
        </Hint>
        <div class="mt-4 overflow-x-auto rounded-md border border-line">
          <ol class="font-mono text-meta leading-5">
            {rows.map((row) =>
              row.kind === 'fold' ? (
                <li class="bg-surface-overlay/50 px-3 py-1 text-ink-faint">{t('description.fold', { n: row.count })}</li>
              ) : (
                // A line of the posting, stored or fetched: data, whatever language the page is in.
                <li class={`flex gap-2 px-3 ${ROW_CLASS[row.kind]}`} translate="no">
                  <span class="w-3 shrink-0 select-none text-ink-faint">{ROW_MARK[row.kind]}</span>
                  <span class="whitespace-pre-wrap break-words">{row.text || ' '}</span>
                </li>
              ),
            )}
          </ol>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <form method="post" action={`/jobs/${job.id}/description`} class="flex">
            <textarea name="text" hidden>{text}</textarea>
            <Button variant="violet">{t('description.replaceTheDescriptionAndRe')}</Button>
          </form>
          <Button href={back} variant="secondary">{t('description.keepTheStoredText')}</Button>
        </div>
      </Card>
    </Layout>
  );
};
