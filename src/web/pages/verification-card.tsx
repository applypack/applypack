/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { JobVerification } from '@prisma/client';
import { ActionForm, Badge, Button, Card, Hint, MarkIcon, SectionTitle, When } from '../ui';
import type { Tone } from '../format';
import { formatRelative, safeHref } from '../format';
import { readEvidence, type VerificationEvidence } from '../../verification/prompts';
import { livenessCodeLabel } from '../../verification/liveness';
import { formatUsd } from '../../ai-spend';
import type { AiBilling } from '../../ai-usage';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

export interface JobLivenessView {
  liveness: string;
  code: string;
  checkedAt: Date;
}

export interface VerificationCardProps {
  jobId: number;
  /** Empty for a pasted posting — the free checks have nothing to ask then (#161). */
  url: string;
  liveness: JobLivenessView | null;
  verification: JobVerification | null;
  verificationCount: number;
  /** A run in flight: the buttons give way to a link to its progress page. */
  run: { id: string; startedAt: number } | null;
  /** What the AI research usually costs here (ai-ledger.ts:typicalCost); the free checks cost nothing. */
  cost: { micro: number; billing: AiBilling } | null;
}

// In the three tables below a label is a catalog key, read when the card renders.
const LIVENESS_VIEW: Record<string, { label: MessageKey; tone: Tone }> = {
  active: { label: 'verify.liveness.active', tone: 'ok' },
  expired: { label: 'verify.liveness.expired', tone: 'danger' },
  uncertain: { label: 'verify.liveness.uncertain', tone: 'neutral' },
};

const codeLabel = (code: string): string => livenessCodeLabel(code) ?? code;

export const VERDICT_TONE: Record<string, Tone> = { legit: 'ok', suspicious: 'warn', fake: 'danger' };
const RECOMMENDATION_VIEW: Record<string, { label: MessageKey; tone: Tone }> = {
  apply: { label: 'verify.recommendation.apply', tone: 'ok' },
  caution: { label: 'verify.recommendation.caution', tone: 'warn' },
  skip: { label: 'verify.recommendation.skip', tone: 'danger' },
};
const SIGNAL_TONE: Record<VerificationEvidence['signal'], Tone> = {
  legit: 'ok',
  ghost: 'warn',
  scam: 'danger',
  neutral: 'neutral',
  unverified: 'neutral',
};
const CHECK_LABEL = {
  careers_page: 'verify.check.careersPage',
  linkedin: 'verify.check.linkedin',
  reputation: 'verify.check.reputation',
  posting_age: 'verify.check.postingAge',
  salary: 'verify.check.salary',
  named_humans: 'verify.check.namedHumans',
  posting_quality: 'verify.check.postingQuality',
  other: 'verify.check.other',
} as const satisfies Record<VerificationEvidence['check'], MessageKey>;

/** A word the verifier chose (a verdict, a signal): what a model wrote, shown as written. */
const ModelWord: FC<{ word: string }> = ({ word }) => <span lang="en">{word}</span>;

function livenessWord(liveness: string): string {
  const view = LIVENESS_VIEW[liveness];
  return view ? t(view.label) : liveness;
}

function recommendationWord(recommendation: string): string {
  const view = RECOMMENDATION_VIEW[recommendation];
  return view ? t(view.label) : recommendation;
}

export const VerificationCard: FC<VerificationCardProps> = ({
  jobId,
  url,
  liveness,
  verification,
  verificationCount,
  run,
  cost,
}) => (
  <div id="verification">
    <Card>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <SectionTitle>{t('verify.isThisJobReal')}</SectionTitle>
          {liveness || verification ? (
            <div class="flex flex-wrap items-center gap-2">
              {liveness && (
                <span title={t('verify.checkedTitle', { how: codeLabel(liveness.code), when: formatRelative(liveness.checkedAt) })}>
                  <Badge tone={LIVENESS_VIEW[liveness.liveness]?.tone ?? 'neutral'}>{livenessWord(liveness.liveness)}</Badge>
                </span>
              )}
              {verification && (
                <>
                  <Badge tone={VERDICT_TONE[verification.verdict] ?? 'neutral'}>
                    <ModelWord word={verification.verdict} />
                  </Badge>
                  <Badge tone={RECOMMENDATION_VIEW[verification.recommendation]?.tone ?? 'neutral'}>
                    {recommendationWord(verification.recommendation)}
                  </Badge>
                  <span class="text-meta tabular-nums text-ink-faint">
                    {t('verify.confidence', { n: verification.confidence })}
                  </span>
                  <span class="text-meta text-ink-faint">
                    · <When at={verification.createdAt} />
                    {verificationCount > 1 ? ` · ${t('verify.runs', { n: verificationCount })}` : ''}
                  </span>
                </>
              )}
            </div>
          ) : (
            <Hint>
              {t('verify.notCheckedYetVerifyFirst')}
            </Hint>
          )}
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          {run ? (
            <Button href={`/target/runs/${run.id}`} variant="secondary" size="sm">
              {tRich('verify.checking', {}, { when: () => <When at={new Date(run.startedAt)} /> })}
            </Button>
          ) : (
            <>
              <ActionForm action={`/jobs/${jobId}/verify`}>
                <Button variant={liveness || verification ? 'secondary' : 'violet'} size="sm">
                  {liveness || verification ? t('verify.reCheck') : t('verify.verify')}
                </Button>
              </ActionForm>
              {liveness && liveness.liveness !== 'uncertain' && (
                <ActionForm action={`/jobs/${jobId}/verify`} hidden={{ deep: 1 }}>
                  <Button variant="violet" size="sm">
                    {t('verify.deepCheckAi')}
                  </Button>
                </ActionForm>
              )}
            </>
          )}
        </div>
      </div>
      {cost && !run && <Hint class="mt-2">{t('verify.costHint', { billing: cost.billing, money: formatUsd(cost.micro) })}</Hint>}
      {liveness && !verification && (
        <p class="mt-3 text-sm text-ink-muted">
          {tRich('verify.checkedLine', { how: codeLabel(liveness.code) }, { when: () => <When at={liveness.checkedAt} /> })}
        </p>
      )}

      {verification && (
        <div class="mt-4 space-y-4">
          {/* The summary, the flags, the findings and the snapshot are the verifier's own words: shown as written. */}
          <p class="text-sm leading-6 text-ink" lang="en">
            {verification.summary}
          </p>

          {verification.redFlags.length > 0 && (
            <ul class="space-y-1 text-sm text-ink-muted" lang="en">
              {verification.redFlags.map((f) => (
                <li class="flex gap-2">
                  <MarkIcon kind="x" class="mt-[3px] text-danger" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}

          <EvidenceList items={readEvidence(verification.evidence)} />

          {verification.companySnapshot && (
            <div>
              <div class="mb-1.5 text-note font-medium text-ink-muted">{t('verify.companySnapshot')}</div>
              <p class="text-sm leading-6 text-ink-muted" lang="en">
                {verification.companySnapshot}
              </p>
            </div>
          )}

          {safeHref(verification.postingUrl) && (
            <div>
              <div class="mb-1.5 text-note font-medium text-ink-muted">{t('verify.companysOwnListing')}</div>
              <div class="flex flex-wrap items-center gap-2">
                <a
                  href={safeHref(verification.postingUrl)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="break-all font-mono text-meta text-accent-strong transition-colors duration-150 hover:text-accent-deep"
                  translate="no"
                >
                  {safeHref(verification.postingUrl)!.replace(/^https?:\/\//, '').slice(0, 80)}
                </a>
                {!run && (
                  <ActionForm action={`/jobs/${jobId}/description/refresh`}>
                    <Button variant="secondary" size="sm">
                      {t('verify.refreshTheDescriptionFromIt')}
                    </Button>
                  </ActionForm>
                )}
              </div>
              <Hint class="mt-1.5">
                {t('verify.readsThatPageAndShows')}
              </Hint>
            </div>
          )}
        </div>
      )}
      {!verification && (
        <Hint class="mt-3">
          {url
            ? t('verify.theFreeChecksAnswerIn')
            : t('verify.thisPostingHasNoUrl')}
        </Hint>
      )}
    </Card>
  </div>
);

const EvidenceList: FC<{ items: VerificationEvidence[] }> = ({ items }) =>
  items.length === 0 ? null : (
    <div>
      <div class="mb-1.5 text-note font-medium text-ink-muted">{t('verify.evidence')}</div>
      <ul class="divide-y divide-line rounded-md border border-line">
        {items.map((e) => (
          <li class="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:gap-3">
            <div class="flex shrink-0 items-center gap-2 sm:w-48">
              <Badge tone={SIGNAL_TONE[e.signal]}>
                <ModelWord word={e.signal} />
              </Badge>
              <span class="text-meta text-ink-muted">{t(CHECK_LABEL[e.check])}</span>
            </div>
            <div class="min-w-0 text-sm text-ink" lang="en">
              {e.finding}
              {safeHref(e.url) && (
                <a
                  href={safeHref(e.url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="ml-2 break-all font-mono text-meta text-accent-strong transition-colors duration-150 hover:text-accent-deep"
                >
                  {safeHref(e.url)!.replace(/^https?:\/\//, '').slice(0, 60)}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
