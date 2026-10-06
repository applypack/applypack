/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { ResumeReview } from '@prisma/client';
import { ActionForm, Badge, Button, Card, FitBadge, Hint, Input, More, SectionTitle, When } from '../ui';
import type { Tone } from '../format';

import { readReviewAdvice, readReviewGrades, type ReviewAdvice } from '../../resume/prompts';
import { answerFor, unansweredAsks, type ReviewAnswer } from '../../resume/answers';
import { deltaSentence, type ReviewDelta } from '../../resume/review-delta';
import {
  capExplanation,
  readReviewBreakdown,
  reviewIsStale,
  REVIEW_DIMENSIONS,
  REVIEW_SCORING,
  type ReviewDimension,
  type ReviewGrade,
} from '../../resume/review-score';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

/*
 * "Is this resume strong?" — the on-demand review (docs/resumes-plan.md §B).
 * Never runs by itself: before the first run the card explains what it checks
 * and what it costs, because an unexplained AI button is one nobody presses.
 *
 * The number comes from review-score.ts, so every element here is display:
 * grades with the candidate's own lines as evidence, advice that either
 * rewrites what is there or asks for the number it would need.
 */

/** A dimension's name is `review.dimension.<key>`; what it asks, its name included, is `review.explain.<key>`. */
const dimensionLabel = (d: ReviewDimension): string => t(`review.dimension.${d}`);
const gradeLabel = (g: ReviewGrade): string => t(`review.grade.${g}`);

const GRADE_TONE: Record<ReviewGrade, Tone> = {
  strong: 'ok',
  ok: 'warn',
  weak: 'danger',
};

const PRIORITY_TONE: Record<ReviewAdvice['priority'], Tone> = {
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
};

const SUBHEAD = 'mb-2 text-note font-medium text-ink-muted';

export interface ResumeReviewCardProps {
  resume: { id: number; version: number; scannedAt: Date | null };
  review: ResumeReview | null;
  /** The candidate's stored answers to earlier asks (answers.ts). */
  answers: ReviewAnswer[];
  /** What moved since the previous run of this resume, when there was one. */
  delta: ReviewDelta | null;
}

export const ResumeReviewCard: FC<ResumeReviewCardProps> = ({ resume, review, answers, delta }) => (
  <div id="resume-strength">
   <Card class="mt-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <SectionTitle>{t('review.resumeStrength')}</SectionTitle>
      <ActionForm action={`/resumes/${resume.id}/review`} once>
        <Button variant="violet" size="sm">
          {review ? t('review.runItAgain') : t('review.runStrengthReview')}
        </Button>
      </ActionForm>
    </div>
    {review ? (
      <ReviewReport resume={resume} review={review} answers={answers} delta={delta} />
    ) : (
      <ReviewExplainer />
    )}
   </Card>
  </div>
);

/** The state before the first run: what it checks, what comes back, what it costs. */
const ReviewExplainer: FC = () => (
  <div class="space-y-3">
    <p class="text-sm leading-6 text-ink">
      {t('review.aHiringManagersReadOf')}
    </p>
    <ul class="grid gap-x-6 gap-y-1.5 text-note leading-5 text-ink-muted sm:grid-cols-2">
      {REVIEW_DIMENSIONS.map((d) => (
        <li>{tRich(`review.explain.${d}`, {}, { b: (words) => <span class="font-medium text-ink">{words}</span> })}</li>
      ))}
    </ul>
    <Hint>{t('review.oneAiCallAboutA')}</Hint>
    <More>
      {t('review.nothingIsRewrittenForYou')}
    </More>
  </div>
);

const ReviewReport: FC<{
  resume: { id: number; version: number };
  review: ResumeReview;
  answers: ReviewAnswer[];
  delta: ReviewDelta | null;
}> = ({ resume, review, answers, delta }) => {
  const bd = readReviewBreakdown(review.breakdown);
  const grades = readReviewGrades(review.grades);
  const advice = readReviewAdvice(review.advice);
  const stale = reviewIsStale(review.resumeVersion, resume.version);
  const capLine = bd ? capExplanation(bd) : null;
  return (
    <div class="mt-3 space-y-5">
      <div class="flex flex-wrap items-center gap-3">
        <FitBadge score={review.reviewScore} label={t('review.strength')} />
        {stale ? (
          <Badge tone="warn">{t('review.readVersion', { reviewed: review.resumeVersion, current: resume.version })}</Badge>
        ) : (
          <Badge tone="info">v{review.resumeVersion}</Badge>
        )}
        <span class="text-meta text-ink-faint">
          <When at={review.createdAt} /> ·{' '}
          <span class="font-mono" translate="no">
            {review.model}
          </span>
        </span>
      </div>
      {/* The review is the model's: its headline, its reasons, its advice stay in the language it wrote them in. */}
      <p class="text-sm leading-6 text-ink" lang="en">
        {review.headline}
      </p>
      <Hint>
        {tRich('review.gradedFromText', {}, {
          link: (words) => (
            <a href="#ats" class="font-medium text-accent-strong hover:text-accent-deep">
              {words}
            </a>
          ),
        })}
      </Hint>
      {delta && <DeltaLine delta={delta} />}
      {capLine && (
        <p class="rounded-md border border-warn/40 bg-surface-overlay/50 px-3 py-2 text-note leading-5 text-ink">
          {capLine}
        </p>
      )}
      {stale && (
        <Hint>{t('review.staleHint', { version: review.resumeVersion })}</Hint>
      )}

      <div>
        <div class={SUBHEAD}>{t('review.howItReadsDimensionBy')}</div>
        <ul class="divide-y divide-line rounded-md border border-line">
          {grades.map((g) => (
            <li class="flex flex-col gap-1.5 p-3 sm:flex-row sm:gap-3">
              <div class="flex shrink-0 items-center gap-2 sm:w-56">
                <Badge tone={GRADE_TONE[g.grade]}>{gradeLabel(g.grade)}</Badge>
                <span class="text-label text-ink">{dimensionLabel(g.dimension)}</span>
                {bd && (
                  <span class="font-mono text-meta text-ink-faint">
                    {bd.points[g.dimension] ?? 0}/{REVIEW_SCORING.weight[g.dimension]}
                  </span>
                )}
              </div>
              <div class="min-w-0 flex-1 text-note leading-5 text-ink-muted">
                <span lang="en">{g.why}</span>
                {g.evidence.length > 0 && (
                  <ul class="mt-1.5 space-y-1" translate="no">
                    {g.evidence.map((e) => (
                      <li class="whitespace-pre-line border-l-2 border-line-strong pl-2 font-mono text-meta text-ink-faint">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {advice.length > 0 && (
        <div>
          <div class={SUBHEAD}>{t('review.whatToChangeHardestHitting')}</div>
          <ul class="divide-y divide-line rounded-md border border-line">
            {advice.map((a) => (
              <li class="space-y-1.5 p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge tone={PRIORITY_TONE[a.priority]}>{t(`review.priority.${a.priority}`)}</Badge>
                  <Badge tone="neutral">{dimensionLabel(a.dimension)}</Badge>
                  <span class="text-sm font-medium text-ink" lang="en">
                    {a.issue}
                  </span>
                </div>
                <div class="text-note leading-5 text-ink-muted" lang="en">
                  {a.why}
                </div>
                <div class="text-note leading-5 text-ink" lang="en">
                  → {a.fix}
                </div>
                {a.quote && (
                  <div class="whitespace-pre-line border-l-2 border-line-strong pl-2 font-mono text-meta text-ink-faint" translate="no">
                    {a.quote}
                  </div>
                )}
                {a.example && (
                  <div class="whitespace-pre-line rounded-md border border-ok/30 bg-surface-overlay/50 px-2.5 py-1.5 text-note leading-5 text-ink">
                    <span class="text-ink-faint">{t('review.rewrite')} </span>
                    <span lang="en">{a.example}</span>
                  </div>
                )}
                {a.ask && (
                  <div class="rounded-md border border-line bg-surface-overlay/50 px-2.5 py-1.5 text-note leading-5 text-ink">
                    <span class="text-ink-faint">{t('review.onlyYouCanAnswer')} </span>
                    <span lang="en">{a.ask}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AnswerBlock resumeId={resume.id} advice={advice} answers={answers} />

      {review.strengths.length > 0 && (
        <div>
          <div class={SUBHEAD}>{t('review.keepTheseTheyAlreadyWork')}</div>
          <ul class="space-y-1 text-note leading-5 text-ink-muted">
            {review.strengths.map((s) => (
              <li class="flex gap-2">
                <span class="text-ok" aria-hidden="true">
                  ✓
                </span>
                <span lang="en">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/**
 * What moved since the previous run of THIS resume (review-delta.ts). A second
 * review raises exactly one question — did the edits work? — and a bare new
 * number does not answer it.
 */
const DeltaLine: FC<{ delta: ReviewDelta }> = ({ delta }) => (
  <div class="space-y-2 rounded-md border border-line bg-surface-overlay/50 px-3 py-2">
    <div class="text-note leading-5 text-ink">{deltaSentence(delta)}</div>
    {delta.moves.length > 0 && (
      <ul class="flex flex-wrap gap-1.5">
        {delta.moves.map((m) => (
          <li>
            <Badge tone={m.up ? 'ok' : 'danger'}>
              {t('review.move', { dimension: dimensionLabel(m.dimension), from: gradeLabel(m.from), to: gradeLabel(m.to) })}
            </Badge>
          </li>
        ))}
      </ul>
    )}
  </div>
);

/**
 * The asks, answerable (ADR 0030 phase 3). The rubric refuses to invent a
 * number and asks for it instead; until now that was a dead end, so the next
 * run asked the same question again. An answer is stored on the resume and
 * read into the NEXT prompt — nothing here spends an AI call, and the copy
 * says so, because a button that costs nothing should not look like one that
 * does.
 */
const AnswerBlock: FC<{ resumeId: number; advice: ReviewAdvice[]; answers: ReviewAnswer[] }> = ({
  resumeId,
  advice,
  answers,
}) => {
  const open = unansweredAsks(advice.map((a) => a.ask), answers);
  // Every stored answer, not just the ones this run happens to ask about: a
  // question that was answered stops being asked, and an answer you cannot
  // see is one you cannot correct.
  const answered = answers.map((a) => a.question);
  if (open.length === 0 && answered.length === 0) return null;
  return (
    <div>
      <div class={SUBHEAD}>
        {t('review.asksHeading', { answered: answered.length, open: open.length })}
      </div>
      <ul class="divide-y divide-line rounded-md border border-line">
        {[...open, ...answered].map((question) => {
          const stored = answerFor(answers, question);
          return (
            <li class="space-y-2 p-3">
              <div class="text-note leading-5 text-ink" lang="en">
                {question}
              </div>
              <form
                method="post"
                action={`/resumes/${resumeId}/answers`}
                class="flex flex-wrap items-center gap-1.5"
              >
                <input type="hidden" name="question" value={question} />
                <Input
                  name="answer"
                  maxlength="300"
                  value={stored?.answer ?? ''}
                  placeholder={t('review.theFigureInYourWords')}
                  aria-label={question}
                  class="!w-64 !px-2 !py-1 !text-meta"
                />
                <Button variant="secondary">
                  {stored ? t('review.update') : t('common.save')}
                </Button>
                {stored && <Badge tone="ok">{t('review.answered')}</Badge>}
              </form>
            </li>
          );
        })}
      </ul>
      <Hint class="mt-2">
        {t('review.savingCostsNothingTheFigure')}
      </Hint>
    </div>
  );
};
