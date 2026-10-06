/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import type { DiffOp } from '../../resume/line-diff';
import type { PrepareStep } from '../../pack/gate';
import type { PackRow } from '../../pack/store';
import { HELD_WORDS, STEP_WORDS, STOP_WORDS, isPackStop, type PackEdits } from '../../pack/view';
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

const WHAT_IT_DOES =
  'One press does what the other tabs do by hand: checks that the posting is still open, compares it with the resume your search hunts with, ' +
  'researches the company on the web, applies the edits your policy allows and keeps the file. It stops early, and says why, when the posting is closed, ' +
  'the resume cannot get close, or the company does not check out. A few minutes of AI; this page updates itself.';

/** The pack in flight: the step it is on, and nothing to press. */
const Preparing: FC<{ pack: PackRow }> = ({ pack }) => (
  <Notice tone="ok" role="status">
    {pack.status === 'queued'
      ? 'Queued — the worker starts it within a minute.'
      : `${STEP_WORDS[pack.step as PrepareStep] ?? 'Preparing'}…`}{' '}
    This page refreshes itself; you can leave it.
  </Notice>
);

const Changes: FC<{ changes: DiffOp[] }> = ({ changes }) => (
  <ul class="divide-y divide-line">
    {changes.map((op) => (
      <li class="py-3">
        {(op.op === 'change' || op.op === 'delete') && (
          <div>
            <div class={LABEL}>{op.op === 'change' ? 'Was' : 'Taken out'}</div>
            <p class={`${QUOTE} border-line-strong text-ink-muted`}>{op.a.text}</p>
          </div>
        )}
        {(op.op === 'change' || op.op === 'insert') && (
          <div class={op.op === 'change' ? 'mt-2' : ''}>
            <div class={LABEL}>{op.op === 'change' ? 'Now' : 'Put in'}</div>
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
        <SectionTitle>Application pack</SectionTitle>
        <Hint>{WHAT_IT_DOES}</Hint>
        <Hint class="mt-2">
          {automatic
            ? 'Packs are prepared on their own for new postings that clear your fit threshold. This one did not qualify, or was found before you switched them on.'
            : 'Packs can also be prepared on their own for strong new matches — Settings → General → Application packs. Off until you switch it on.'}
        </Hint>
        <ActionForm action={prepare} class="mt-3" once>
          <Button variant="violet" size="sm">
            Prepare the pack
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
      label={pack.status === 'ready' ? 'Prepare again' : 'Try again'}
      confirm="This starts the pack over: the checks are repeated where their results are no longer current, and the resume is tailored again. The pack shown here is replaced."
      yes="Prepare again"
      variant="secondary"
    />
  );

  return (
    <div id="application-pack" class="space-y-4">
      <Card>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <SectionTitle>Application pack</SectionTitle>
            <div class="flex flex-wrap items-center gap-2">
              {pack.status === 'ready' && pack.scoreBefore !== null && (
                <Badge tone="ok">
                  match {pack.scoreBefore}
                  {pack.scoreAfter !== null && pack.scoreAfter !== pack.scoreBefore ? ` → ${pack.scoreAfter}` : ''}
                </Badge>
              )}
              {company && (
                <>
                  <Badge tone={VERDICT_TONE[company.verdict] ?? 'neutral'}>{company.verdict}</Badge>
                  <Badge tone={company.recommendation === 'apply' ? 'ok' : 'neutral'}>{company.recommendation}</Badge>
                </>
              )}
              {pack.sentAt && (
                <Badge tone="ok">
                  sent <When at={pack.sentAt} />
                </Badge>
              )}
              {pack.finishedAt && !busy && (
                <span class="text-meta text-ink-faint">
                  prepared <When at={pack.finishedAt} />
                  {pack.resumeName ? ` · from ${pack.resumeName}` : ''}
                </span>
              )}
            </div>
          </div>
          {pack.status === 'ready' && (
            <div class="flex flex-wrap items-center gap-2">
              {files.docx && (
                <Button href={`/jobs/${jobId}/pack/resume.docx`} size="sm">
                  Download .docx
                </Button>
              )}
              {files.pdf && (
                <Button href={`/jobs/${jobId}/pack/resume.pdf`} variant="secondary" size="sm">
                  Download .pdf
                </Button>
              )}
              {safeHref(url) && (
                <Button href={safeHref(url)!} variant="secondary" size="sm" target="_blank" rel="noopener noreferrer">
                  Open posting
                </Button>
              )}
            </div>
          )}
        </div>

        <div class="mt-3 space-y-3">
          {busy && <Preparing pack={pack} />}
          {pack.status === 'failed' && (
            <Notice tone="danger">
              The pack could not be prepared: {pack.why ?? 'no reason was recorded'} Nothing of yours was changed; you can try again.
            </Notice>
          )}
          {pack.status === 'stopped' && (
            <Notice tone="warn">
              <strong class="font-medium">{isPackStop(pack.stop) ? STOP_WORDS[pack.stop] : 'Stopped'}.</strong> {pack.why}
            </Notice>
          )}
          {pack.status === 'ready' && pack.why && <Notice tone="warn">{pack.why}</Notice>}
          {pack.status === 'ready' && edits.checks.length > 0 && (
            <Notice tone="warn">
              The edits did not pass a safety check ({edits.checks.join(', ')}), so none was kept: the file is your resume as it stood.
            </Notice>
          )}
          {pack.status === 'ready' && pack.document === 'clean' && (
            <Hint>
              The file is the same text re-set in the look read off your resume, because the resume is not a .docx the edits can be written into. Upload a
              .docx on Resumes to keep your own file.
            </Hint>
          )}
          {pack.status === 'ready' && !pack.sentAt && (
            <form method="post" action={`/jobs/${jobId}/status`} class="flex flex-wrap items-center gap-2">
              <input type="hidden" name="status" value="APPLIED" />
              <input type="hidden" name="pack" value="1" />
              <input type="hidden" name="tab" value="pack" />
              <Button variant="secondary" size="sm">
                I sent this file — mark applied
              </Button>
              <Hint>Keeps this file as the record of what went out; it can be downloaded here at any time, and the pack no longer changes.</Hint>
            </form>
          )}
          {pack.sentAt && <Hint>This is the file that went out. It stays here for as long as the job does.</Hint>}
        </div>

        {(tailorHref || again || letter) && !busy && (
          <div class="mt-4 flex flex-wrap items-center gap-2">
            {tailorHref && pack.status === 'ready' && (
              <Button href={tailorHref} variant="secondary" size="sm">
                Go on in the Tailor page →
              </Button>
            )}
            {pack.matchId && pack.status !== 'ready' && (
              <Button href={jobHref(jobId, 'match', { match: pack.matchId })} variant="secondary" size="sm">
                See the comparison →
              </Button>
            )}
            {letter && (
              <Button href={jobHref(jobId, 'letter')} variant="secondary" size="sm">
                Read the cover letter →
              </Button>
            )}
            {again}
          </div>
        )}
      </Card>

      {company && (
        <Card>
          <SectionTitle>The company</SectionTitle>
          <p class="text-sm leading-6 text-ink">{company.summary}</p>
          {company.snapshot && <p class="mt-2 text-sm leading-6 text-ink-muted">{company.snapshot}</p>}
          <p class="mt-2 text-note">
            <a class="text-accent underline-offset-2 hover:underline" href={jobHref(jobId, 'verify')}>
              The evidence, link by link →
            </a>
          </p>
        </Card>
      )}

      {pack.status === 'ready' && (asks.length > 0 || unbacked.length > 0) && (
        <Card>
          <SectionTitle>What still stands between you and this posting</SectionTitle>
          {asks.length > 0 && (
            <p class="text-sm leading-6 text-ink">
              <span class="font-medium">To ask you:</span> {asks.join(', ')}.{' '}
              <a class="text-accent underline-offset-2 hover:underline" href={jobHref(jobId, 'match', pack.matchId ? { match: pack.matchId } : {})}>
                Answer on the comparison
              </a>{' '}
              — a yes is written into the next pack.
            </p>
          )}
          {unbacked.length > 0 && (
            <p class={`text-sm leading-6 text-ink-muted ${asks.length > 0 ? 'mt-2' : ''}`}>
              <span class="font-medium text-ink">Nothing in your resume backs:</span> {unbacked.join(', ')}. These are never written in for you.
            </p>
          )}
        </Card>
      )}

      {pack.status === 'ready' && (
        <Card>
          <SectionTitle>{changes.length === 0 ? 'Nothing was changed' : `What was changed (${changes.length} ${changes.length === 1 ? 'line' : 'lines'})`}</SectionTitle>
          {changes.length === 0 ? (
            <Hint>The policy and the comparison left this resume as it was.</Hint>
          ) : (
            <Changes changes={changes} />
          )}
          {edits.unplaced.length > 0 && (
            <Hint class="mt-2">
              {edits.unplaced.length} {edits.unplaced.length === 1 ? 'edit' : 'edits'} could not be placed: the text it quoted is not in the resume as written.
            </Hint>
          )}
        </Card>
      )}

      {pack.status === 'ready' && edits.held.length > 0 && (
        <Card>
          <SectionTitle>Left for you ({edits.held.length})</SectionTitle>
          <ul class="space-y-1 text-sm leading-6 text-ink-muted">
            {edits.held.map((h) => (
              <li>
                <span class="text-ink">
                  {h.section} · {h.where}
                </span>{' '}
                — {HELD_WORDS[h.reason]}
              </li>
            ))}
          </ul>
          <Hint class="mt-2">Each is a card on the Tailor page, with its own Apply and Edit &amp; apply.</Hint>
        </Card>
      )}
    </div>
  );
};
