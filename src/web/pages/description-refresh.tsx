/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Hint, PageHeader } from '../ui';
import { describeRefresh, type PreviewRow, type RefreshPlan } from '../../jobs/description-diff';

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
  const back = `/jobs/${job.id}#verification`;
  return (
    <Layout title="Refresh the description" active="jobs">
      <PageHeader
        title="Refresh the description"
        meta={`${job.title} · ${job.companyName}`}
        back={{ href: back, label: 'Back to the job' }}
      />
      <Card>
        <p class="text-sm leading-6 text-ink">
          The company's own listing,{' '}
          <a href={url} target="_blank" rel="noopener noreferrer" class="break-all font-mono text-xs text-accent-strong hover:text-accent-deep">
            {url.replace(/^https?:\/\//, '')}
          </a>
          , reads {describeRefresh(plan)}
        </p>
        {!plan.mentionsTitle && (
          <Hint class="mt-2">
            That page does not mention the title "{job.title}" — it may be the board's index or a login wall rather than
            this posting. Read the lines below before replacing anything.
          </Hint>
        )}
        <Hint class="mt-2">
          Replacing keeps the stored text (Restore the original on the job page), re-classifies the posting against your
          running searches, and makes the next comparison read its keywords afresh — earlier scores judged another text.
        </Hint>
        <div class="mt-4 overflow-x-auto rounded-md border border-line">
          <ol class="font-mono text-[12px] leading-5">
            {rows.map((row) =>
              row.kind === 'fold' ? (
                <li class="bg-surface-overlay/50 px-3 py-1 text-ink-faint">… {row.count} unchanged line{row.count === 1 ? '' : 's'} …</li>
              ) : (
                <li class={`flex gap-2 px-3 ${ROW_CLASS[row.kind]}`}>
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
            <Button variant="violet">Replace the description and re-classify</Button>
          </form>
          <Button href={back} variant="secondary">Keep the stored text</Button>
        </div>
      </Card>
    </Layout>
  );
};
