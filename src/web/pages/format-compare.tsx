/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Badge, Card, Hint, PageHeader, SectionTitle } from '../ui';
import type { DiffList, FormatComparison, FormatReading } from '../format-compare';
import { ParsedViewBlock } from './parsed-view-block';
import { t } from '../../i18n/t';

/*
 * The same resume as two files, read side by side (TASKS R14): which one a
 * plain parser reads better, what each gives, and the lines where they
 * differ. Rendered from the upload, never stored.
 */

export interface FormatComparePageProps {
  resume: { id: number; name: string };
  /** The saved file's name and the uploaded one's. */
  files: [string, string];
  result: FormatComparison;
}

function verdict(r: FormatComparison): string {
  if (r.identical) return t('parsed.verdict.identical');
  if (r.better === 'same') return t('parsed.verdict.same');
  const [winner, loser] = r.better === 'a' ? [r.a, r.b] : [r.b, r.a];
  // The winner's name opens the sentence, in every language the catalog has.
  return t('parsed.verdict.better', { winner: `${winner.name[0]!.toUpperCase()}${winner.name.slice(1)}`, loser: loser.name });
}

const Side: FC<{ reading: FormatReading; file: string }> = ({ reading, file }) => (
  <Card>
    <SectionTitle>{reading.label}</SectionTitle>
    <p class="-mt-2 mb-3 break-all text-meta text-ink-faint" translate="no">
      {file}
    </p>
    <ParsedViewBlock view={reading.view} />
    {reading.warnings.length === 0 ? (
      <Hint>{t('parsed.noParseWarnings')}</Hint>
    ) : (
      <ul class="space-y-1.5">
        {reading.warnings.map((w) => (
          <li class="text-sm text-ink-muted">
            <Badge tone="warn">{t('parsed.warningBadge')}</Badge> {w}
          </li>
        ))}
      </ul>
    )}
  </Card>
);

const More: FC<{ list: DiffList<unknown> }> = ({ list }) =>
  list.total > list.lines.length ? (
    <li class="text-meta text-ink-faint" translate="yes">
      {t('parsed.andMore', { n: list.total - list.lines.length })}
    </li>
  ) : null;

const Lines: FC<{ title: string; list: DiffList<string> }> = ({ title, list }) =>
  list.total === 0 ? null : (
    <div>
      <h3 class="text-label text-ink">{title}</h3>
      {/* The lines are the resume's own text. */}
      <ul class="mt-1.5 space-y-1 font-mono text-meta leading-5 text-ink-muted" translate="no">
        {list.lines.map((line) => (
          <li class="break-words">{line}</li>
        ))}
        <More list={list} />
      </ul>
    </div>
  );

export const FormatComparePage: FC<FormatComparePageProps> = ({ resume, files, result }) => {
  const { a, b, changed } = result;
  const differs = result.onlyA.total + result.onlyB.total + result.moved.total + changed.total > 0;
  return (
    <Layout title={t('parsed.pageTitle', { name: resume.name })} active="resumes">
      <PageHeader
        title={t('parsed.twoFilesOneResume')}
        meta={t('parsed.pageMeta', { name: resume.name })}
        back={{ href: `/resumes/${resume.id}#ats`, label: t('resume.backToResume') }}
      />
      <Card>
        <p class="text-sm leading-6 text-ink">{verdict(result)}</p>
        {result.reasons.length > 0 && (
          <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {result.reasons.map((reason) => (
              <li>{reason}</li>
            ))}
          </ul>
        )}
        <Hint class="mt-3">
          {t('parsed.measuredInTheOrderAn')}
        </Hint>
      </Card>

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <Side reading={a} file={files[0]} />
        <Side reading={b} file={files[1]} />
      </div>

      {!result.identical && (
        <Card class="mt-4">
          <SectionTitle>{t('parsed.whereTheTextDiffers')}</SectionTitle>
          {differs ? (
            <div class="space-y-4">
              <Lines title={t('parsed.onlyIn', { name: a.name })} list={result.onlyA} />
              <Lines title={t('parsed.onlyIn', { name: b.name })} list={result.onlyB} />
              <Lines title={t('parsed.inBothInADifferent')} list={result.moved} />
              {changed.total > 0 && (
                <div>
                  <h3 class="text-label text-ink">{t('parsed.readDifferently')}</h3>
                  <ul class="mt-1.5 space-y-2 font-mono text-meta leading-5">
                    {changed.lines.map((pair) => (
                      <li class="break-words">
                        <div class="text-ink-muted">
                          {a.label}: <span translate="no">{pair.a}</span>
                        </div>
                        <div class="text-ink">
                          {b.label}: <span translate="no">{pair.b}</span>
                        </div>
                      </li>
                    ))}
                    <More list={changed} />
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <Hint>{t('parsed.theSameLinesInThe')}</Hint>
          )}
        </Card>
      )}
    </Layout>
  );
};
