/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Badge, Button, Card, FitBadge, Flash, Hint } from '../ui';
import type { FlashMessage } from '../flash';
import { formatRelative } from '../format';
import type { MatchWithResume } from '../../resume/store';
import { readActions, readKeywords, readRemovals } from '../../resume/prompts';
import { MatchReport } from './resume-match-card';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';

/*
 * Targeted resume: job description with keyword highlights on the left, the
 * resume text in an editor on the right. Editing is local (nothing is saved
 * until "Save as new version"); the keyword-coverage score and both panes'
 * highlights re-render on every keystroke from /static/target.mjs. The AI
 * match (keywords, actions, removals) is the fixed frame the live score works
 * within — "Re-analyze with AI" sends the edited text back to Claude.
 */

export interface TargetPageProps {
  job: { id: number; title: string; companyName: string; location: string; description: string };
  resume: { id: number; name: string; version: number };
  match: MatchWithResume;
  matches: MatchWithResume[];
  /** The text the selected match analysed (not necessarily the resume's current text). */
  resumeText: string;
  flash?: FlashMessage | null;
}

const TABS = [
  { key: 'both', label: 'Side by side' },
  { key: 'job', label: 'Job description' },
  { key: 'resume', label: 'Your resume' },
  { key: 'changes', label: 'Changes' },
] as const;

export const TargetPage: FC<TargetPageProps> = ({ job, resume, match, matches, resumeText, flash }) => {
  const keywords = readKeywords(match.keywords);
  const clientData = {
    matchId: match.id,
    resumeText,
    jobText: job.description,
    keywords,
    actions: readActions(match.actions),
    removals: readRemovals(match.removals),
  };
  return (
    <Layout title={`Target · ${job.title}`} active="jobs">
      <a href={`/jobs/${job.id}#resume-match`} class="mb-4 inline-block text-xs text-ink-faint hover:text-ink">
        ← {job.title}
      </a>
      <Flash flash={flash} />

      <div class="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold tracking-tight">Targeted resume</h1>
          <div class="mt-1 text-sm text-ink-muted">
            {job.companyName} · {job.title}
            {job.location ? ` · ${job.location}` : ''}
          </div>
        </div>
        <ul class="flex flex-wrap gap-2">
          {matches.map((m) => (
            <li>
              <a
                href={`/jobs/${job.id}/target?match=${m.id}`}
                aria-current={m.id === match.id ? 'true' : undefined}
                class={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  m.id === match.id
                    ? 'border-accent/60 bg-accent/5 text-ink'
                    : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                <FitBadge score={m.matchScore} label="AI match" />
                {m.resume.name}
                <span class="font-mono text-ink-faint">v{m.resumeVersion}</span>
                {m.draft && <Badge tone="violet">draft</Badge>}
                <span class="text-ink-faint">{formatRelative(m.createdAt)}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <Card class="mb-4">
        <div class="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div class="flex items-center gap-4">
            <svg viewBox="0 0 96 96" class="h-20 w-20 -rotate-90" aria-hidden="true">
              <circle cx="48" cy="48" r="40" fill="none" stroke="rgb(var(--line-strong))" stroke-width="8" />
              <circle
                id="score-ring"
                cx="48"
                cy="48"
                r="40"
                fill="none"
                stroke="currentColor"
                stroke-width="8"
                stroke-linecap="round"
                stroke-dasharray="251.3"
                stroke-dashoffset="251.3"
                class="text-warn transition-[stroke-dashoffset] duration-300"
              />
            </svg>
            <div>
              <div class="font-mono text-3xl font-medium tabular-nums text-ink">
                <span id="score-value">—</span>
                <span class="text-base text-ink-faint">/100</span>
              </div>
              <div class="text-xs uppercase tracking-wider text-ink-faint">Keyword coverage · live</div>
              <div id="score-detail" class="mt-0.5 text-xs text-ink-muted">
                {keywords.length} keywords from the AI match
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-1 text-sm">
            <div class="flex items-center gap-2">
              <FitBadge score={match.matchScore} label="AI match" />
              <span class="text-ink-muted">AI match</span>
              <span class="text-xs text-ink-faint">
                {resume.name} v{match.resumeVersion}
                {match.draft ? ' (draft)' : ''} · {formatRelative(match.createdAt)}
              </span>
            </div>
            <Hint>
              Live score counts keywords only. AI match judges the whole resume against the posting
              (same rubric every run). Aim for 85+ on both.
            </Hint>
          </div>

          <div class="ml-auto flex flex-wrap items-center gap-2">
            <label class="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
              <input id="include-cannot" type="checkbox" class="h-4 w-4 rounded border-line-strong bg-surface text-accent" />
              count "can't claim" keywords
            </label>
            <form method="post" action={`/jobs/${job.id}/match`} id="reanalyze-form">
              <input type="hidden" name="resumeId" value={resume.id} />
              <input type="hidden" name="draftText" id="reanalyze-text" value="" />
              <input type="hidden" name="next" value="target" />
              <Button variant="violet" title="Sends the text in the editor to the resume model (~1 min)">
                Re-analyze with AI
              </Button>
            </form>
            <form method="post" action={`/resumes/${resume.id}/draft`} id="save-form">
              <input type="hidden" name="text" id="save-text" value="" />
              <input type="hidden" name="jobId" value={job.id} />
              <Button variant="secondary" id="save-button" disabled title="Enabled once you edit the text">
                Save as v{resume.version + 1}
              </Button>
            </form>
            <details class="relative">
              <summary class="inline-flex min-h-[32px] cursor-pointer list-none items-center rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink hover:bg-surface-overlay">
                Re-upload resume
              </summary>
              <form
                method="post"
                action={`/jobs/${job.id}/target/reupload`}
                enctype="multipart/form-data"
                class="absolute right-0 z-10 mt-2 w-80 space-y-2 rounded-md border border-line bg-surface-overlay p-3 shadow-lg"
              >
                <input type="hidden" name="resumeId" value={resume.id} />
                <input
                  type="file"
                  name="file"
                  required
                  accept={ACCEPTED_EXTENSIONS.join(',')}
                  class="block w-full text-xs text-ink file:mr-2 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-xs file:text-ink"
                />
                <Button size="sm" class="w-full">
                  Upload v{resume.version + 1} &amp; re-analyze
                </Button>
                <Hint>New version, scan and AI match in one go — about 2 minutes.</Hint>
              </form>
            </details>
          </div>
        </div>
      </Card>

      <div class="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="View">
        {TABS.map((t) => (
          <button
            type="button"
            role="tab"
            data-tab={t.key}
            aria-selected={t.key === 'both'}
            class="tab rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink aria-selected:border-accent/60 aria-selected:bg-accent/5 aria-selected:text-ink"
          >
            {t.label}
          </button>
        ))}
        <span id="edit-state" class="ml-auto text-xs text-ink-faint" aria-live="polite"></span>
      </div>

      <div id="panes" class="grid gap-4 lg:grid-cols-2" data-view="both">
        <Card class="pane-job">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div class="text-xs font-semibold uppercase tracking-wider text-ink-muted">Job description</div>
            <div class="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
              <span><mark class="kw-found rounded px-1">found</mark></span>
              <span><mark class="kw-missing rounded px-1">missing</mark></span>
              <span><mark class="kw-cannot rounded px-1">can't claim</mark></span>
              <label class="inline-flex cursor-pointer items-center gap-1.5">
                <input id="hide-found" type="checkbox" class="h-3.5 w-3.5 rounded border-line-strong bg-surface text-accent" />
                hide found
              </label>
            </div>
          </div>
          <div id="jd" class="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-7 text-ink-muted"></div>
        </Card>

        <Card class="pane-resume">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div class="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Your resume · {resume.name} v{match.resumeVersion}
            </div>
            <div class="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
              <span><mark class="kw-present rounded px-1">keyword</mark></span>
              <span><mark class="edit-change rounded px-1">change</mark></span>
              <span><mark class="edit-remove rounded px-1">remove</mark></span>
              <button type="button" id="reset-edits" class="text-ink-muted underline-offset-2 hover:text-ink hover:underline">
                reset edits
              </button>
            </div>
          </div>
          <div id="missing-chips" class="mb-3 flex flex-wrap gap-1.5"></div>
          <div class="editor relative h-[70vh] overflow-hidden rounded-md border border-line-strong bg-surface">
            <div id="backdrop" class="editor-layer" aria-hidden="true"></div>
            <textarea id="editor" class="editor-layer" spellcheck={false} aria-label="Resume text (editable, not saved)"></textarea>
          </div>
          <Hint class="mt-2">
            Plain text — what an ATS parser sees. Edits stay in this browser tab until you Re-analyze or
            Save. Click an item in Changes to jump to it.
          </Hint>
        </Card>

        <div class="pane-changes lg:col-span-2">
          <Card>
            <div class="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">Changes</div>
            <MatchReport match={match} previous={null} jumpable />
          </Card>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: TARGET_CSS }} />
      <script id="target-data" type="application/json" dangerouslySetInnerHTML={{ __html: safeJson(clientData) }} />
      <script type="module" dangerouslySetInnerHTML={{ __html: TARGET_JS }} />
    </Layout>
  );
};

/** JSON inside a <script> must not contain "</script"; escaping "<" keeps it inert. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const TARGET_CSS = `
  mark { color: inherit; border-radius: 3px; }
  .kw-found, .kw-present { background: rgb(var(--ok) / 0.22); }
  .kw-missing { background: rgb(var(--warn) / 0.3); }
  .kw-cannot { background: rgb(var(--ink-faint) / 0.3); text-decoration: line-through; }
  .edit-remove { background: rgb(var(--danger) / 0.25); text-decoration: line-through; }
  .edit-change { background: rgb(var(--warn) / 0.12); box-shadow: inset 0 0 0 1px rgb(var(--warn) / 0.8); }
  .hide-found .kw-found { background: transparent; }
  .editor-layer {
    position: absolute; inset: 0; margin: 0; padding: 16px; overflow: auto;
    font-family: "Fira Sans", ui-sans-serif, system-ui, sans-serif; font-size: 14px; line-height: 1.6;
    white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; tab-size: 4;
  }
  #backdrop { color: rgb(var(--ink)); pointer-events: none; overflow: hidden; }
  #editor { background: transparent; color: transparent; caret-color: rgb(var(--ink)); border: 0; outline: none; resize: none; }
  #editor::selection { background: rgb(var(--accent) / 0.35); }
  #panes[data-view="job"] .pane-resume, #panes[data-view="job"] .pane-changes,
  #panes[data-view="resume"] .pane-job, #panes[data-view="resume"] .pane-changes,
  #panes[data-view="both"] .pane-changes,
  #panes[data-view="changes"] .pane-job, #panes[data-view="changes"] .pane-resume { display: none; }
  #panes[data-view="job"] .pane-job, #panes[data-view="resume"] .pane-resume { grid-column: 1 / -1; }
  .chip { cursor: pointer; }
  .flash-target { animation: flash-target 1.2s ease-out; }
  @keyframes flash-target { from { background: rgb(var(--accent) / 0.35); } to { background: transparent; } }
`;

const TARGET_JS = `
import { scoreKeywords, highlightHtml, jobSpans, resumeSpans, locateQuote } from '/static/target.mjs';

const data = JSON.parse(document.getElementById('target-data').textContent);
const editor = document.getElementById('editor');
const backdrop = document.getElementById('backdrop');
const jd = document.getElementById('jd');
const ring = document.getElementById('score-ring');
const scoreValue = document.getElementById('score-value');
const scoreDetail = document.getElementById('score-detail');
const chips = document.getElementById('missing-chips');
const editState = document.getElementById('edit-state');
const includeCannot = document.getElementById('include-cannot');
const hideFound = document.getElementById('hide-found');
const saveButton = document.getElementById('save-button');
const RING = 251.3;
const storageKey = 'target-draft:' + data.matchId;

function load() {
  try { return localStorage.getItem(storageKey); } catch { return null; }
}
function store(text) {
  try {
    if (text === data.resumeText) localStorage.removeItem(storageKey); else localStorage.setItem(storageKey, text);
  } catch {}
}

function tone(score) {
  return score >= 85 ? 'text-ok' : score >= 70 ? 'text-info' : score >= 50 ? 'text-warn' : 'text-danger';
}

function render() {
  const text = editor.value;
  const scored = scoreKeywords(data.keywords, text, { includeCannotClaim: includeCannot.checked });
  scoreValue.textContent = String(scored.score);
  ring.setAttribute('stroke-dashoffset', String(RING - (RING * scored.score) / 100));
  ring.setAttribute('class', tone(scored.score) + ' transition-[stroke-dashoffset] duration-300');
  const counted = scored.rows.filter((r) => !r.excluded);
  scoreDetail.textContent = counted.filter((r) => r.found).length + ' of ' + counted.length + ' keywords present'
    + (scored.rows.length - counted.length ? ' · ' + (scored.rows.length - counted.length) + " can't claim excluded" : '');

  backdrop.innerHTML = highlightHtml(text, resumeSpans(data.keywords, data.actions, data.removals, text)) + '\\n';
  jd.innerHTML = highlightHtml(data.jobText, jobSpans(data.keywords, data.jobText, scored));

  chips.innerHTML = '';
  for (const r of scored.rows.filter((r) => !r.found && !r.excluded).sort((a, b) => a.priority - b.priority)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs ring-1 ring-inset bg-warn/10 text-warn ring-warn/25';
    b.textContent = r.term + ' · P' + r.priority;
    b.title = (r.where ? 'Add in: ' + r.where + '. ' : '') + (r.note || '');
    b.addEventListener('click', () => jumpToSection(r.where));
    chips.appendChild(b);
  }
  if (chips.children.length === 0) chips.innerHTML = '<span class="text-xs text-ink-faint">Every countable keyword is present.</span>';

  const dirty = text !== data.resumeText;
  editState.textContent = dirty ? 'edited · not saved' : '';
  saveButton.disabled = !dirty;
  document.getElementById('save-text').value = text;
  document.getElementById('reanalyze-text').value = dirty ? text : '';
  store(text);
}

function jumpToSection(where) {
  if (!where) return;
  const hint = where.toLowerCase();
  const sections = ['summary', 'skills', 'experience', 'education', 'title'];
  const wanted = sections.find((s) => hint.includes(s));
  const lines = editor.value.split('\\n');
  let offset = 0;
  for (const line of lines) {
    if (wanted && line.toLowerCase().includes(wanted) && line.length < 60) { select(offset, offset + line.length); return; }
    offset += line.length + 1;
  }
}

function select(start, end) {
  editor.focus();
  editor.setSelectionRange(start, end);
  // Scroll the caret into view: temporarily collapse the selection at the end, then restore.
  const before = editor.value.slice(0, start);
  const lineIndex = before.split('\\n').length - 1;
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 22;
  editor.scrollTop = Math.max(0, lineIndex * lineHeight - editor.clientHeight / 3);
  backdrop.scrollTop = editor.scrollTop;
}

let timer = null;
editor.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
editor.addEventListener('scroll', () => { backdrop.scrollTop = editor.scrollTop; backdrop.scrollLeft = editor.scrollLeft; });
includeCannot.addEventListener('change', render);
hideFound.addEventListener('change', () => jd.classList.toggle('hide-found', hideFound.checked));
document.getElementById('reset-edits').addEventListener('click', () => { editor.value = data.resumeText; render(); });

for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('[role=tab]')) t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    document.getElementById('panes').dataset.view = tab.dataset.tab;
    if (tab.dataset.tab !== 'changes') render();
  });
}

for (const item of document.querySelectorAll('[data-quote]')) {
  item.addEventListener('click', () => {
    const loc = locateQuote(editor.value, item.dataset.quote);
    if (!loc) { item.classList.add('flash-target'); setTimeout(() => item.classList.remove('flash-target'), 1200); return; }
    document.querySelector('[role=tab][data-tab=both]').click();
    select(loc.start, loc.end);
  });
}

editor.value = load() ?? data.resumeText;
render();
`;
