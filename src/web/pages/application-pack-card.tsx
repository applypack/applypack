/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { DiffOp } from '../../resume/line-diff';
import type { PrepareStep } from '../../pack/gate';
import type { PackRow } from '../../pack/store';
import { HELD_WORDS, STEP_WORDS, stopTitle, type PackEdits } from '../../pack/view';
import { t } from '../../i18n/t';
import { tRich } from '../rich';
import { ActionForm, Badge, Button, Card, ConfirmAction, Hint, Notice, SectionTitle, When } from '../ui';
import { safeHref } from '../format';
import { jobHref } from '../job-tabs';
import { VERDICT_TONE } from './verification-card';

export interface ApplicationPackProps {
  jobId: number;
  /** The posting's own page — where the application is made. Empty for a pasted posting. */
  url: string;
  pack: PackRow | null;
  files: { docx: boolean; pdf: boolean };
  edits: PackEdits;
  /** The lines the edits changed, as the Tailor page's own diff reads them. */
  changes: DiffOp[];
  /** The company check the pack read; null when there was none. */
  company: { verdict: string; recommendation: string; summary: string; snapshot: string | null } | null;
  /** Keywords the comparison asks the person about, and ones nothing in the resume backs. */
  asks: string[];
  unbacked: string[];
  /** Whether a cover letter was written with the pack. */
  letter: boolean;
  /** Whether packs are prepared on their own (Settings → General); the empty state says which. */
  automatic: boolean;
}

const LABEL = 'text-meta font-medium uppercase tracking-wide text-ink-faint';
const QUOTE = 'mt-0.5 whitespace-pre-wrap break-words border-l-2 pl-2 text-sm leading-6';

/** The pack in flight: the step it is on, and nothing to press. */
const Preparing: FC<{ pack: PackRow }> = ({ pack }) => {
  const step = STEP_WORDS[pack.step as PrepareStep];
  return (
    <Notice tone="ok" role="status">
      {pack.status === 'queued' ? t('pack.card.queued') : t('pack.card.onStep', { step: step ? t(step) : t('pack.card.preparing') })}{' '}
      {t('pack.card.refreshes')}
    </Notice>
  );
};

const Changes: FC<{ changes: DiffOp[] }> = ({ changes }) => (
  <ul class="divide-y divide-line">
    {changes.map((op) => (
      <li class="py-3">
        {(op.op === 'change' || op.op === 'delete') && (
          <div>
            <div class={LABEL}>{op.op === 'change' ? t('pack.card.was') : t('pack.card.takenOut')}</div>
            <p class={`${QUOTE} border-line-strong text-ink-muted`}>{op.a.text}</p>
          </div>
        )}
        {(op.op === 'change' || op.op === 'insert') && (
          <div class={op.op === 'change' ? 'mt-2' : ''}>
            <div class={LABEL}>{op.op === 'change' ? t('pack.card.now') : t('pack.card.putIn')}</div>
            <p class={`${QUOTE} border-accent/50 text-ink`}>{op.b.text}</p>
          </div>
        )}
      </li>
    ))}
  </ul>
);

export const ApplicationPackCard: FC<ApplicationPackProps> = ({ jobId, url, pack, files, edits, changes, company, asks, unbacked, letter, automatic }) => {
  const prepare = `/jobs/${jobId}/pack`;
  if (!pack) {
    return (
      <Card>
        <SectionTitle>{t('pack.card.title')}</SectionTitle>
        <Hint>{t('pack.card.whatItDoes')}</Hint>
        <Hint class="mt-2">{automatic ? t('pack.card.automaticOn') : t('pack.card.automaticOff')}</Hint>
        <ActionForm action={prepare} class="mt-3" once>
          <Button variant="violet" size="sm">
            {t('pack.card.prepare')}
          </Button>
        </ActionForm>
      </Card>
    );
  }
  const busy = pack.status === 'queued' || pack.status === 'running';
  const tailorHref = pack.tailoredMatchId ?? pack.matchId ? `/jobs/${jobId}/target?match=${pack.tailoredMatchId ?? pack.matchId}` : null;
  const again = !busy && !pack.sentAt && (
    <ConfirmAction
      action={prepare}
      label={pack.status === 'ready' ? t('pack.card.prepareAgain') : t('pack.card.tryAgain')}
      confirm={t('pack.card.againConfirm')}
      yes={t('pack.card.prepareAgain')}
      variant="secondary"
    />
  );

  return (
    <div id="application-pack" class="space-y-4">
      <Card>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <SectionTitle>{t('pack.card.title')}</SectionTitle>
            <div class="flex flex-wrap items-center gap-2">
              {pack.status === 'ready' && pack.scoreBefore !== null && (
                <Badge tone="ok">
                  {pack.scoreAfter !== null && pack.scoreAfter !== pack.scoreBefore
                    ? t('pack.line.matchMoved', { before: pack.scoreBefore, after: pack.scoreAfter })
                    : t('pack.line.match', { score: pack.scoreBefore })}
                </Badge>
              )}
              {company && (
                <>
                  {/* The verdict is the verifier's own word, shown as written (verification-card.tsx). */}
                  <Badge tone={VERDICT_TONE[company.verdict] ?? 'neutral'}>
                    <span lang="en">{company.verdict}</span>
                  </Badge>
                  <Badge tone={company.recommendation === 'apply' ? 'ok' : 'neutral'}>
                    {t('pack.card.recommendation', { recommendation: company.recommendation })}
                  </Badge>
                </>
              )}
              {pack.sentAt && <Badge tone="ok">{tRich('pack.card.sent', {}, { when: () => <When at={pack.sentAt!} /> })}</Badge>}
              {pack.finishedAt && !busy && (
                <span class="text-meta text-ink-faint">
                  {pack.resumeName
                    ? tRich('pack.card.preparedFrom', { resume: pack.resumeName }, { when: () => <When at={pack.finishedAt!} /> })
                    : tRich('pack.card.prepared', {}, { when: () => <When at={pack.finishedAt!} /> })}
                </span>
              )}
            </div>
          </div>
          {pack.status === 'ready' && (
            <div class="flex flex-wrap items-center gap-2">
              {files.docx && (
                <Button href={`/jobs/${jobId}/pack/resume.docx`} size="sm">
                  {t('ui.downloadDocx')}
                </Button>
              )}
              {files.pdf && (
                <Button href={`/jobs/${jobId}/pack/resume.pdf`} variant="secondary" size="sm">
                  {t('pack.card.downloadPdf')}
                </Button>
              )}
              {safeHref(url) && (
                <Button href={safeHref(url)!} variant="secondary" size="sm" target="_blank" rel="noopener noreferrer">
                  {t('pack.card.openPosting')}
                </Button>
              )}
            </div>
          )}
        </div>

        <div class="mt-3 space-y-3">
          {busy && <Preparing pack={pack} />}
          {pack.status === 'failed' && (
            <Notice tone="danger">{t('pack.card.failed', { why: pack.why ?? t('pack.card.noReason') })}</Notice>
          )}
          {pack.status === 'stopped' && (
            <Notice tone="warn">
              <strong class="font-medium">{stopTitle(pack.stop)}</strong> {pack.why}
            </Notice>
          )}
          {pack.status === 'ready' && pack.why && <Notice tone="warn">{pack.why}</Notice>}
          {pack.status === 'ready' && edits.checks.length > 0 && (
            <Notice tone="warn">{t('pack.card.checksFailed', { checks: edits.checks.join(', ') })}</Notice>
          )}
          {pack.status === 'ready' && pack.document === 'clean' && (
            <Hint>{t('pack.card.cleanFile')}</Hint>
          )}
          {pack.status === 'ready' && !pack.sentAt && (
            <form method="post" action={`/jobs/${jobId}/status`} class="flex flex-wrap items-center gap-2">
              <input type="hidden" name="status" value="APPLIED" />
              <input type="hidden" name="pack" value="1" />
              <input type="hidden" name="tab" value="pack" />
              <Button variant="secondary" size="sm">
                {t('pack.card.markSent')}
              </Button>
              <Hint>{t('pack.card.markSentHint')}</Hint>
            </form>
          )}
          {pack.sentAt && <Hint>{t('pack.card.sentHint')}</Hint>}
        </div>

        {(tailorHref || again || letter) && !busy && (
          <div class="mt-4 flex flex-wrap items-center gap-2">
            {tailorHref && pack.status === 'ready' && (
              <Button href={tailorHref} variant="secondary" size="sm">
                {t('pack.card.goOnTailor')}
              </Button>
            )}
            {pack.matchId && pack.status !== 'ready' && (
              <Button href={jobHref(jobId, 'match', { match: pack.matchId })} variant="secondary" size="sm">
                {t('pack.card.seeComparison')}
              </Button>
            )}
            {letter && (
              <Button href={jobHref(jobId, 'letter')} variant="secondary" size="sm">
                {t('pack.card.readLetter')}
              </Button>
            )}
            {again}
          </div>
        )}
      </Card>

      {company && (
        <Card>
          <SectionTitle>{t('pack.card.company')}</SectionTitle>
          <p class="text-sm leading-6 text-ink" lang="en">
            {company.summary}
          </p>
          {company.snapshot && (
            <p class="mt-2 text-sm leading-6 text-ink-muted" lang="en">
              {company.snapshot}
            </p>
          )}
          <p class="mt-2 text-note">
            <a class="text-accent underline-offset-2 hover:underline" href={jobHref(jobId, 'verify')}>
              {t('pack.card.evidence')}
            </a>
          </p>
        </Card>
      )}

      {pack.status === 'ready' && (asks.length > 0 || unbacked.length > 0) && (
        <Card>
          <SectionTitle>{t('pack.card.standsBetween')}</SectionTitle>
          {asks.length > 0 && (
            <p class="text-sm leading-6 text-ink">
              {tRich(
                'pack.card.asks',
                { terms: asks.join(', ') },
                {
                  label: (words) => <span class="font-medium">{words}</span>,
                  terms: (words) => <span translate="no">{words}</span>,
                  link: (words) => (
                    <a class="text-accent underline-offset-2 hover:underline" href={jobHref(jobId, 'match', pack.matchId ? { match: pack.matchId } : {})}>
                      {words}
                    </a>
                  ),
                },
              )}
            </p>
          )}
          {unbacked.length > 0 && (
            <p class={`text-sm leading-6 text-ink-muted ${asks.length > 0 ? 'mt-2' : ''}`}>
              {tRich(
                'pack.card.unbacked',
                { terms: unbacked.join(', ') },
                {
                  label: (words) => <span class="font-medium text-ink">{words}</span>,
                  terms: (words) => <span translate="no">{words}</span>,
                },
              )}
            </p>
          )}
        </Card>
      )}

      {pack.status === 'ready' && (
        <Card>
          <SectionTitle>{changes.length === 0 ? t('pack.card.nothingChanged') : t('pack.card.changed', { n: changes.length })}</SectionTitle>
          {changes.length === 0 ? (
            <Hint>{t('pack.card.leftAsItWas')}</Hint>
          ) : (
            <Changes changes={changes} />
          )}
          {edits.unplaced.length > 0 && (
            <Hint class="mt-2">{t('pack.card.unplaced', { n: edits.unplaced.length })}</Hint>
          )}
        </Card>
      )}

      {pack.status === 'ready' && edits.held.length > 0 && (
        <Card>
          <SectionTitle>{t('pack.card.leftForYou', { n: edits.held.length })}</SectionTitle>
          <ul class="space-y-1 text-sm leading-6 text-ink-muted">
            {edits.held.map((h) => (
              <li>
                <span class="text-ink">
                  {h.section} · {h.where}
                </span>{' '}
                — {t(HELD_WORDS[h.reason])}
              </li>
            ))}
          </ul>
          <Hint class="mt-2">{t('pack.card.heldHint')}</Hint>
        </Card>
      )}
    </div>
  );
};
