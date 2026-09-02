/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { ResumeReview } from '@prisma/client';
import { ActionForm, Badge, Button, Card, FitBadge, Hint, Input, SectionTitle } from '../ui';
import type { Tone } from '../format';
import { formatRelative } from '../format';
import { readReviewAdvice, readReviewGrades, type ReviewAdvice } from '../../resume/prompts';
import { answerFor, unansweredAsks, type ReviewAnswer } from '../../resume/answers';
import { deltaSentence, type ReviewDelta } from '../../resume/review-delta';
import {
  capExplanation,
  readReviewBreakdown,
  reviewIsStale,
  REVIEW_SCORING,
  type ReviewDimension,
  type ReviewGrade,
} from '../../resume/review-score';

/*
 * "Is this resume strong?" — the on-demand review (docs/resumes-plan.md §B).
 * Never runs by itself: before the first run the card explains what it checks
 * and what it costs, because an unexplained AI button is one nobody presses.
 *
 * The number comes from review-score.ts, so every element here is display:
 * grades with the candidate's own lines as evidence, advice that either
 * rewrites what is there or asks for the number it would need.
 */

const DIMENSION_LABEL: Record<ReviewDimension, string> = {
  first_impression: 'First impression',
  impact: 'Impact & outcomes',
  seniority_signal: 'Seniority signal',
  clarity: 'Clarity & structure',
  keyword_coverage: 'Skill evidence',
  polish: 'Wording & polish',
};

/** What each dimension asks, in the words the card shows before the first run. */
const DIMENSION_BLURB: Record<ReviewDimension, string> = {
  first_impression: 'does the top of the page say who you are and at what level',
  impact: 'do the bullets say what changed, or only what you were responsible for',
  seniority_signal: 'does the wording show the scope you claim',
  clarity: 'structure, length and whether a parser can read it',
  keyword_coverage: 'are the skills you list actually evidenced in the work',
  polish: 'verbs, filler and consistency',
};

const GRADE_VIEW: Record<ReviewGrade, { label: string; tone: Tone }> = {
  strong: { label: 'strong', tone: 'ok' },
  ok: { label: 'ok', tone: 'warn' },
  weak: { label: 'weak', tone: 'danger' },
};

const PRIORITY_TONE: Record<ReviewAdvice['priority'], Tone> = {
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
};

const SUBHEAD = 'mb-2 text-[13px] font-medium text-ink-muted';

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
      <SectionTitle>Resume strength</SectionTitle>
      <ActionForm action={`/resumes/${resume.id}/review`} once>
        <Button variant="violet" size="sm">
          {review ? 'Run it again' : 'Run strength review'}
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
      A hiring manager's read of this resume on its own — no job posting. Six dimensions get a
      grade with quotes from your own text, and you get a prioritized list of what to change.
    </p>
    <ul class="grid gap-x-6 gap-y-1.5 text-[13px] leading-5 text-ink-muted sm:grid-cols-2">
      {(Object.keys(DIMENSION_LABEL) as ReviewDimension[]).map((d) => (
        <li>
          <span class="font-medium text-ink">{DIMENSION_LABEL[d]}</span> — {DIMENSION_BLURB[d]}
        </li>
      ))}
    </ul>
    <Hint>
      One AI call, about a minute. Nothing runs on its own and nothing is rewritten for you: where
      a stronger line would need a number your resume doesn't have, the advice asks you for it
      instead of inventing one.
    </Hint>
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
        <FitBadge score={review.reviewScore} label="strength" />
        {stale ? (
          <Badge tone="warn">
            read v{review.resumeVersion} — the resume is at v{resume.version}
          </Badge>
        ) : (
          <Badge tone="info">v{review.resumeVersion}</Badge>
        )}
        <span class="text-xs text-ink-faint">
          {formatRelative(review.createdAt)} · <span class="font-mono">{review.model}</span>
        </span>
      </div>
      <p class="text-sm leading-6 text-ink">{review.headline}</p>
      {delta && <DeltaLine delta={delta} />}
      {capLine && (
        <p class="rounded-md border border-warn/40 bg-surface-overlay/50 px-3 py-2 text-[13px] leading-5 text-ink">
          {capLine}
        </p>
      )}
      {stale && (
        <Hint>
          This review judged v{review.resumeVersion}. Run it again to grade the current text.
        </Hint>
      )}

      <div>
        <div class={SUBHEAD}>How it reads, dimension by dimension</div>
        <ul class="divide-y divide-line rounded-md border border-line">
          {grades.map((g) => (
            <li class="flex flex-col gap-1.5 p-3 sm:flex-row sm:gap-3">
              <div class="flex shrink-0 items-center gap-2 sm:w-56">
                <Badge tone={GRADE_VIEW[g.grade].tone}>{GRADE_VIEW[g.grade].label}</Badge>
                <span class="text-[13px] font-medium text-ink">{DIMENSION_LABEL[g.dimension]}</span>
                {bd && (
                  <span class="font-mono text-xs text-ink-faint">
                    {bd.points[g.dimension] ?? 0}/{REVIEW_SCORING.weight[g.dimension]}
                  </span>
                )}
              </div>
              <div class="min-w-0 flex-1 text-[13px] leading-5 text-ink-muted">
                {g.why}
                {g.evidence.length > 0 && (
                  <ul class="mt-1.5 space-y-1">
                    {g.evidence.map((e) => (
                      <li class="whitespace-pre-line border-l-2 border-line-strong pl-2 font-mono text-xs text-ink-faint">
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
          <div class={SUBHEAD}>What to change — hardest-hitting first</div>
          <ul class="divide-y divide-line rounded-md border border-line">
            {advice.map((a) => (
              <li class="space-y-1.5 p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge tone={PRIORITY_TONE[a.priority]}>{a.priority}</Badge>
                  <Badge tone="neutral">{DIMENSION_LABEL[a.dimension]}</Badge>
                  <span class="text-sm font-medium text-ink">{a.issue}</span>
                </div>
                <div class="text-[13px] leading-5 text-ink-muted">{a.why}</div>
                <div class="text-[13px] leading-5 text-ink">→ {a.fix}</div>
                {a.quote && (
                  <div class="whitespace-pre-line border-l-2 border-line-strong pl-2 font-mono text-xs text-ink-faint">
                    {a.quote}
                  </div>
                )}
                {a.example && (
                  <div class="whitespace-pre-line rounded-md border border-ok/30 bg-surface-overlay/50 px-2.5 py-1.5 text-[13px] leading-5 text-ink">
                    <span class="text-ink-faint">Rewrite: </span>
                    {a.example}
                  </div>
                )}
                {a.ask && (
                  <div class="rounded-md border border-violet/30 bg-surface-overlay/50 px-2.5 py-1.5 text-[13px] leading-5 text-ink">
                    <span class="text-ink-faint">Only you can answer: </span>
                    {a.ask}
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
          <div class={SUBHEAD}>Keep these — they already work</div>
          <ul class="space-y-1 text-[13px] leading-5 text-ink-muted">
            {review.strengths.map((s) => (
              <li class="flex gap-2">
                <span class="text-ok" aria-hidden="true">
                  ✓
                </span>
                <span>{s}</span>
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
    <div class="text-[13px] leading-5 text-ink">{deltaSentence(delta)}</div>
    {delta.moves.length > 0 && (
      <ul class="flex flex-wrap gap-1.5">
        {delta.moves.map((m) => (
          <li>
            <Badge tone={m.up ? 'ok' : 'danger'}>
              {DIMENSION_LABEL[m.dimension]} {m.from} → {m.to}
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
        Only you can answer these — {answered.length} answered,{' '}
        {open.length === 0 ? 'none open' : `${open.length} open`}
      </div>
      <ul class="divide-y divide-line rounded-md border border-violet/30">
        {[...open, ...answered].map((question) => {
          const stored = answerFor(answers, question);
          return (
            <li class="space-y-2 p-3">
              <div class="text-[13px] leading-5 text-ink">{question}</div>
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
                  placeholder="the figure, in your words"
                  aria-label={question}
                  class="!w-64 !px-2 !py-1 !text-xs"
                />
                <Button size="sm" variant={stored ? 'secondary' : 'violet'}>
                  {stored ? 'Update' : 'Save'}
                </Button>
                {stored && <Badge tone="ok">answered</Badge>}
              </form>
            </li>
          );
        })}
      </ul>
      <Hint class="mt-2">
        Saving costs nothing — the figure goes into the next review, which rewrites the line with
        it instead of asking again.
      </Hint>
    </div>
  );
};
