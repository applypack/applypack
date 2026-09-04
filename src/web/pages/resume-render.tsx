/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Badge, Button, Card, Field, Flash, Hint, Input, PageHeader, SectionTitle, Select, SUBMIT_ONCE } from '../ui';
import type { FlashMessage } from '../flash';
import type { JsonResume } from '../../resume/json-resume';
import { structureCoverage } from '../../resume/json-resume';
import { LIMITS, SECTION_KEYS, SECTION_LABELS, type RenderKnobs } from '../../resume/render/knobs';
import { typefaceNote } from '../../resume/render/clean-pdf';
import type { ParseWarning } from '../../resume/parse-warnings';

/*
 * "Clean version in your typeface" (ADR 0039) — the page for a resume whose
 * file cannot be edited in place: a PDF, or a .docx whose layout the patcher
 * refuses. The knobs are prefilled from the user's own file, the preview is
 * exactly what an ATS reads out of the .docx we would write, and the label
 * never claims this is their design back.
 */

export interface RenderPageProps {
  resume: { id: number; name: string; version: number; sourceFilename: string };
  knobs: RenderKnobs;
  structure: JsonResume;
  /** Where the structure came from — the scan's reading or the deterministic one. */
  origin: 'scan' | 'text';
  /** Where the typography came from; 'none' means the file said nothing. */
  styleSource: 'docx' | 'pdf' | 'none';
  /** The plain text the .docx renders to — literally what the ATS gets. */
  preview: string;
  warnings: ParseWarning[];
  reason: string;
  flash?: FlashMessage | null;
}

const ORIGIN_NOTE: Record<RenderPageProps['origin'], string> = {
  scan: 'Read by the AI scan of this resume, then checked line by line against your own words — anything it did not copy exactly was dropped.',
  text: 'Read from the resume text by the built-in reader. Run a scan on this resume for a closer reading, especially of a skills table.',
};

const STYLE_NOTE: Record<RenderPageProps['styleSource'], string> = {
  docx: 'Prefilled from your .docx — its own font, sizes, accent colour, page and margins.',
  pdf: 'Prefilled from your PDF — its font, sizes, page and margins. A PDF does not report its accent colour, so that one is yours to set.',
  none: 'Your file did not say what it is set in, so these are the defaults. Change anything.',
};

export const ResumeRenderPage: FC<RenderPageProps> = ({
  resume,
  knobs,
  structure,
  origin,
  styleSource,
  preview,
  warnings,
  reason,
  flash,
}) => {
  const coverage = structureCoverage(structure);
  const action = `/resumes/${resume.id}/render`;
  return (
    <Layout title={`Clean version — ${resume.name}`} active="resumes">
      <PageHeader
        title="Clean version in your typeface"
        meta={`${resume.name} · v${resume.version}`}
        back={{ href: `/resumes/${resume.id}`, label: 'Back to the resume' }}
      />
      <Flash flash={flash} />

      <Card>
        <SectionTitle>What this makes</SectionTitle>
        <p class="text-sm text-ink">
          A single-column <span class="font-medium">.docx</span> and{' '}
          <span class="font-medium">.pdf</span> of the same words, set in the typography below. It is{' '}
          <span class="font-medium">not</span> your original design — the layout is rebuilt from scratch, plainly, so
          that every parser can read it and so that the editor can write into it afterwards.
        </p>
        <Hint class="mt-2">{reason}</Hint>
        <Hint class="mt-1">{typefaceNote(knobs.fontFamily)}</Hint>
      </Card>

      <Card class="mt-4">
        <SectionTitle>What it found in your resume</SectionTitle>
        <div class="flex flex-wrap items-center gap-2">
          <Badge tone={origin === 'scan' ? 'ok' : 'neutral'}>{origin === 'scan' ? 'From the scan' : 'From the text'}</Badge>
          <span class="text-sm text-ink-muted">
            {coverage.sections} {coverage.sections === 1 ? 'section' : 'sections'} · {coverage.roles}{' '}
            {coverage.roles === 1 ? 'role' : 'roles'} · {coverage.bullets}{' '}
            {coverage.bullets === 1 ? 'bullet' : 'bullets'}
          </span>
        </div>
        <Hint class="mt-2">{ORIGIN_NOTE[origin]}</Hint>
      </Card>

      <form method="post" action={action} class="mt-4" onsubmit={SUBMIT_ONCE}>
        <Card>
          <SectionTitle>Typography</SectionTitle>
          <Hint class="mb-3">{STYLE_NOTE[styleSource]}</Hint>
          <fieldset class="border-0 p-0">
            <legend class="sr-only">Typeface and sizes</legend>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Font family" hint="Named in the .docx">
                <Input name="fontFamily" value={knobs.fontFamily} maxlength={60} autocomplete="off" />
              </Field>
              <Field label="Body size (pt)">
                <Input
                  type="number" name="bodyPt" value={String(knobs.bodyPt)} step="0.5"
                  min={String(LIMITS.bodyPt.min)} max={String(LIMITS.bodyPt.max)}
                />
              </Field>
              <Field label="Name size (pt)">
                <Input
                  type="number" name="namePt" value={String(knobs.namePt)} step="0.5"
                  min={String(LIMITS.namePt.min)} max={String(LIMITS.namePt.max)}
                />
              </Field>
              <Field label="Heading size (pt)">
                <Input
                  type="number" name="headingPt" value={String(knobs.headingPt)} step="0.5"
                  min={String(LIMITS.headingPt.min)} max={String(LIMITS.headingPt.max)}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset class="mt-4 border-0 p-0">
            <legend class="sr-only">Page and colour</legend>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Accent colour" hint="Headings and their rules. Empty for none.">
                <Input name="accentHex" value={knobs.accentHex ?? ''} placeholder="0070c0" maxlength={7} autocomplete="off" />
              </Field>
              <Field label="Page size">
                <Select name="page">
                  <option value="LETTER" selected={knobs.page === 'LETTER'}>US Letter</option>
                  <option value="A4" selected={knobs.page === 'A4'}>A4</option>
                </Select>
              </Field>
              <Field label="Section order" hint="Comma-separated; anything left out is appended.">
                <Input name="sectionOrder" value={knobs.sectionOrder.join(',')} mono autocomplete="off" />
              </Field>
              <div class="flex items-end">
                <label class="flex min-h-[28px] cursor-pointer items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="nameCentered" checked={knobs.nameCentered} class="size-4 accent-accent" />
                  Centre the name and contact line
                </label>
              </div>
            </div>
            <Hint class="mt-2">
              Sections you can name: {SECTION_KEYS.map((k) => SECTION_LABELS[k] || k).join(', ').toLowerCase()}.
            </Hint>
          </fieldset>

          <fieldset class="mt-4 border-0 p-0">
            <legend class="block text-[13px] font-medium text-ink">Margins (inches)</legend>
            <div class="mt-1.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <Field label={side[0]!.toUpperCase() + side.slice(1)}>
                  <Input
                    type="number" step="0.05"
                    name={`margin${side[0]!.toUpperCase()}${side.slice(1)}`}
                    value={String(knobs.margins[side])}
                    min={String(LIMITS.marginIn.min)} max={String(LIMITS.marginIn.max)}
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        </Card>

        <Card class="mt-4">
          <SectionTitle>Take it away</SectionTitle>
          <div class="flex flex-wrap gap-2">
            {/* The mode rides in a hidden field: a disabled submitter's own value
                never reaches the form (SUBMIT_ONCE disables them all). */}
            <input type="hidden" name="mode" value="preview" id="render-mode" />
            <Button onclick="document.getElementById('render-mode').value='preview'">Update the preview</Button>
            <Button variant="secondary" onclick="document.getElementById('render-mode').value='docx'">
              Download .docx
            </Button>
            <Button variant="secondary" onclick="document.getElementById('render-mode').value='pdf'">
              Download .pdf
            </Button>
            <Button variant="secondary" onclick="document.getElementById('render-mode').value='save'">
              Save as a new resume
            </Button>
          </div>
          <Hint class="mt-2">
            Saving keeps the .docx as a resume of its own, beside this one — the loop then continues on a file the
            editor can write into. This resume is not touched by any of the four.
          </Hint>
        </Card>
      </form>

      <Card class="mt-4">
        <SectionTitle>What the ATS sees</SectionTitle>
        <Hint class="mb-2">
          The text a parser reads out of the .docx above — produced by rendering it and reading it back, not by
          guessing.
        </Hint>
        {warnings.length > 0 ? (
          <ul class="mb-3 space-y-1 text-sm text-warn">
            {warnings.map((w) => (
              <li>{w.message}</li>
            ))}
          </ul>
        ) : (
          <p class="mb-3 text-sm text-ok">No parse problems in the rendered file.</p>
        )}
        <pre class="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-ink">
          {preview}
        </pre>
      </Card>
    </Layout>
  );
};
