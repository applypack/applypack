/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { JobVerification } from '@prisma/client';
import { ActionForm, Badge, Button, Card, Hint, MarkIcon, SectionTitle } from '../ui';
import type { Tone } from '../format';
import { formatRelative } from '../format';
import { readEvidence, type VerificationEvidence } from '../../verification/prompts';

export interface VerificationCardProps {
  jobId: number;
  verification: JobVerification | null;
  verificationCount: number;
}

const VERDICT_TONE: Record<string, Tone> = { legit: 'ok', suspicious: 'warn', fake: 'danger' };
const RECOMMENDATION_VIEW: Record<string, { label: string; tone: Tone }> = {
  apply: { label: 'worth applying', tone: 'ok' },
  caution: { label: 'apply with caution', tone: 'warn' },
  skip: { label: 'skip', tone: 'danger' },
};
const SIGNAL_TONE: Record<VerificationEvidence['signal'], Tone> = {
  legit: 'ok',
  ghost: 'warn',
  scam: 'danger',
  neutral: 'neutral',
  unverified: 'neutral',
};
const CHECK_LABEL: Record<VerificationEvidence['check'], string> = {
  careers_page: 'Careers page',
  linkedin: 'LinkedIn',
  reputation: 'Reputation',
  posting_age: 'Posting age',
  salary: 'Salary',
  named_humans: 'Named humans',
  posting_quality: 'Posting quality',
  other: 'Other',
};

export const VerificationCard: FC<VerificationCardProps> = ({
  jobId,
  verification,
  verificationCount,
}) => (
  <div id="verification">
    <Card>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <SectionTitle>Is this job real?</SectionTitle>
          {verification ? (
            <div class="flex flex-wrap items-center gap-2">
              <Badge tone={VERDICT_TONE[verification.verdict] ?? 'neutral'}>
                {verification.verdict}
              </Badge>
              <Badge tone={RECOMMENDATION_VIEW[verification.recommendation]?.tone ?? 'neutral'}>
                {RECOMMENDATION_VIEW[verification.recommendation]?.label ??
                  verification.recommendation}
              </Badge>
              <span class="text-xs tabular-nums text-ink-faint">
                {verification.confidence}% confidence
              </span>
              <span class="text-xs text-ink-faint">
                · {formatRelative(verification.createdAt)}
                {verificationCount > 1 ? ` · ${verificationCount} runs` : ''}
              </span>
            </div>
          ) : (
            <Hint>
              Not checked yet. Verify searches the web for the company's careers page, LinkedIn
              footprint, reputation and scam signals, then says whether to apply.
            </Hint>
          )}
        </div>
        <ActionForm action={`/jobs/${jobId}/verify`}>
          <Button variant={verification ? 'secondary' : 'violet'} size="sm">
            {verification ? 'Re-verify' : 'Verify'}
          </Button>
        </ActionForm>
      </div>

      {verification && (
        <div class="mt-4 space-y-4">
          <p class="text-sm leading-6 text-ink">{verification.summary}</p>

          {verification.redFlags.length > 0 && (
            <ul class="space-y-1 text-sm text-ink-muted">
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
              <div class="mb-1.5 text-[13px] font-medium text-ink-muted">Company snapshot</div>
              <p class="text-sm leading-6 text-ink-muted">
                {verification.companySnapshot}
              </p>
            </div>
          )}
        </div>
      )}
      {!verification && (
        <Hint class="mt-3">
          Takes 2-4 minutes — the model searches and reads pages before answering.
        </Hint>
      )}
    </Card>
  </div>
);

const EvidenceList: FC<{ items: VerificationEvidence[] }> = ({ items }) =>
  items.length === 0 ? null : (
    <div>
      <div class="mb-1.5 text-[13px] font-medium text-ink-muted">Evidence</div>
      <ul class="divide-y divide-line rounded-md border border-line">
        {items.map((e) => (
          <li class="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:gap-3">
            <div class="flex shrink-0 items-center gap-2 sm:w-48">
              <Badge tone={SIGNAL_TONE[e.signal]}>{e.signal}</Badge>
              <span class="text-xs text-ink-muted">{CHECK_LABEL[e.check]}</span>
            </div>
            <div class="min-w-0 text-sm text-ink">
              {e.finding}
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="ml-2 break-all font-mono text-xs text-accent-strong transition-colors duration-150 hover:text-accent-deep"
                >
                  {e.url.replace(/^https?:\/\//, '').slice(0, 60)}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
