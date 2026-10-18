/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Field, Flash, Hint, Input, PageHeader, SectionTitle, Select, SUBMIT_ONCE } from '../ui';
import type { FlashMessage } from '../flash';
import type { JsonResume } from '../../resume/json-resume';
import { structureCoverage } from '../../resume/json-resume';
import { LIMITS, SECTION_KEYS, SECTION_LABELS, type RenderKnobs } from '../../resume/render/knobs';
import { typefaceNote } from '../../resume/render/clean-pdf';
import type { ParseWarning } from '../../resume/parse-warnings';
import type { MessageKey } from '../../i18n/catalog';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

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
  /** Where the structure came from — the AI's reading (structure.ts) or the built-in reader's. */
  origin: 'ai' | 'text';
  /** Lines under the roles that the AI reading lacks (structure-complete.ts): few enough to draw it, said so the person can look. */
  lostLines?: number;
  /** Where the typography came from; 'none' means the file said nothing. */
  styleSource: 'docx' | 'pdf' | 'none';
  /** The plain text the .docx renders to — literally what the ATS gets. */
  preview: string;
  /** Characters the bundled face cannot draw, which the render removes. */
  dropped?: string[];
  warnings: ParseWarning[];
  reason: string;
  flash?: FlashMessage | null;
}

const ORIGIN_NOTE = {
  ai: 'render.origin.ai',
  text: 'render.origin.builtIn',
} as const satisfies Record<RenderPageProps['origin'], MessageKey>;

const STYLE_NOTE = {
  docx: 'render.style.docx',
  pdf: 'render.style.pdf',
  none: 'render.style.none',
} as const satisfies Record<RenderPageProps['styleSource'], MessageKey>;

export const ResumeRenderPage: FC<RenderPageProps> = ({
  resume,
  knobs,
  structure,
  origin,
  lostLines = 0,
  styleSource,
  preview,
  dropped = [],
  warnings,
  reason,
  flash,
}) => {
  const coverage = structureCoverage(structure);
  const action = `/resumes/${resume.id}/render`;
  return (
    <Layout title={t('render.pageTitle', { name: resume.name })} active="resumes">
      <PageHeader
        title={t('render.cleanVersionInYourTypeface')}
        meta={<span translate="no">{`${resume.name} · v${resume.version}`}</span>}
        back={{ href: `/resumes/${resume.id}`, label: t('render.backToTheResume') }}
      />
      <Flash flash={flash} />

      <Card>
        <SectionTitle>{t('render.whatThisMakes')}</SectionTitle>
        <p class="text-sm text-ink">
          {tRich('render.whatThisMakesBody', {}, { b: (words) => <span class="font-medium">{words}</span> })}
        </p>
        <Hint class="mt-2">{reason}</Hint>
        <Hint class="mt-1">{typefaceNote(knobs.fontFamily)}</Hint>
      </Card>

      <Card class="mt-4">
        <SectionTitle>{t('render.whatItFoundInYour')}</SectionTitle>
        <div class="flex flex-wrap items-center gap-2">
          <Badge tone={origin === 'ai' ? 'ok' : 'neutral'}>{origin === 'ai' ? t('render.readByTheAi') : t('render.fromTheText')}</Badge>
          <span class="text-sm text-ink-muted">
            {t('render.coverage', { sections: coverage.sections, roles: coverage.roles, bullets: coverage.bullets })}
          </span>
        </div>
        <Hint class="mt-2">{t(ORIGIN_NOTE[origin])}</Hint>
        {lostLines > 0 && <p class="mt-2 text-sm text-warn">{t('render.aiLeftOut', { n: lostLines })}</p>}
        {origin === 'text' && (
          <ActionForm action={`/resumes/${resume.id}/render/shape`} class="mt-3" once>
            <Button size="sm" variant="violet" title={t('render.oneAiCallUnderA')}>
              {t('render.readTheShapeWithAi')}
            </Button>
          </ActionForm>
        )}
      </Card>

      <form method="post" action={action} class="mt-4" onsubmit={SUBMIT_ONCE}>
        <Card>
          <SectionTitle>{t('render.typography')}</SectionTitle>
          <Hint class="mb-3">{t(STYLE_NOTE[styleSource])}</Hint>
          <fieldset class="border-0 p-0">
            <legend class="sr-only">{t('render.typefaceAndSizes')}</legend>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t('render.fontFamily')} hint={t('render.namedInTheDocx')}>
                <Input name="fontFamily" value={knobs.fontFamily} maxlength={60} autocomplete="off" />
              </Field>
              <Field label={t('render.bodySizePt')}>
                <Input
                  type="number" name="bodyPt" value={String(knobs.bodyPt)} step="0.5"
                  min={String(LIMITS.bodyPt.min)} max={String(LIMITS.bodyPt.max)}
                />
              </Field>
              <Field label={t('render.nameSizePt')}>
                <Input
                  type="number" name="namePt" value={String(knobs.namePt)} step="0.5"
                  min={String(LIMITS.namePt.min)} max={String(LIMITS.namePt.max)}
                />
              </Field>
              <Field label={t('render.headingSizePt')}>
                <Input
                  type="number" name="headingPt" value={String(knobs.headingPt)} step="0.5"
                  min={String(LIMITS.headingPt.min)} max={String(LIMITS.headingPt.max)}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset class="mt-4 border-0 p-0">
            <legend class="sr-only">{t('render.pageAndColour')}</legend>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t('render.accentColour')} hint={t('render.headingsAndTheirRulesEmpty')}>
                <Input name="accentHex" value={knobs.accentHex ?? ''} placeholder="0070c0" maxlength={7} autocomplete="off" />
              </Field>
              <Field label={t('render.pageSize')}>
                <Select name="page">
                  <option value="LETTER" selected={knobs.page === 'LETTER'}>{t('render.usLetter')}</option>
                  <option value="A4" selected={knobs.page === 'A4'}>A4</option>
                </Select>
              </Field>
              <Field label={t('render.sectionOrder')} hint={t('render.commaSeparatedAnythingLeftOut')}>
                <Input name="sectionOrder" value={knobs.sectionOrder.join(',')} mono autocomplete="off" />
              </Field>
              <div class="flex items-end">
                <label class="flex min-h-[28px] cursor-pointer items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="nameCentered" checked={knobs.nameCentered} class="size-4 accent-accent" />
                  {t('render.centreTheNameAndContact')}
                </label>
              </div>
            </div>
            <Hint class="mt-2">
              {/* The names are typed into the field as they stand, so they stay as they are in every language. */}
              {tRich(
                'render.sectionsYouCanName',
                { names: SECTION_KEYS.map((k) => SECTION_LABELS[k] || k).join(', ').toLowerCase() },
                { list: (words) => <span translate="no">{words}</span> },
              )}
            </Hint>
          </fieldset>

          <fieldset class="mt-4 border-0 p-0">
            <legend class="block text-label text-ink">{t('render.marginsInches')}</legend>
            <div class="mt-1.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <Field label={t(`render.margin.${side}`)}>
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
          <SectionTitle>{t('render.takeItAway')}</SectionTitle>
          <div class="flex flex-wrap gap-2">
            {/* Two channels on purpose. WITH JavaScript the mode rides in
                the hidden field, because SUBMIT_ONCE disables every button and a
                disabled submitter's own value never reaches the form. WITHOUT it
                the onclick never runs and the hidden field would keep saying
                "preview" — all four buttons previewed — so each button also
                carries its own name and value, which is what a plain browser
                submits. The route reads `submitMode` first for that reason. */}
            <input type="hidden" name="mode" value="preview" id="render-mode" />
            <Button name="submitMode" value="preview" onclick="document.getElementById('render-mode').value='preview'">
              {t('render.updateThePreview')}
            </Button>
            <Button
              variant="secondary"
              name="submitMode"
              value="docx"
              onclick="document.getElementById('render-mode').value='docx'"
            >
              {t('ui.downloadDocx')}
            </Button>
            <Button
              variant="secondary"
              name="submitMode"
              value="pdf"
              onclick="document.getElementById('render-mode').value='pdf'"
            >
              {t('render.downloadPdf')}
            </Button>
            <Button
              variant="secondary"
              name="submitMode"
              value="save"
              onclick="document.getElementById('render-mode').value='save'"
            >
              {t('render.saveAsANewResume')}
            </Button>
          </div>
          <Hint class="mt-2">
            {t('render.savingKeepsTheDocxAs')}
          </Hint>
        </Card>
      </form>

      <Card class="mt-4">
        <SectionTitle>{t('render.whatTheAtsSees')}</SectionTitle>
        <Hint class="mb-2">
          {t('render.theTextAParserReads')}
        </Hint>
        {dropped.length > 0 && (
          <p class="mb-3 text-sm text-warn">
            {t('render.droppedChars', { n: dropped.length, chars: dropped.map((c) => `"${c}"`).join(' ') })}
          </p>
        )}
        {warnings.length > 0 ? (
          <ul class="mb-3 space-y-1 text-sm text-warn">
            {warnings.map((w) => (
              <li>{w.shown}</li>
            ))}
          </ul>
        ) : (
          <p class="mb-3 text-sm text-ok">{t('render.noParseProblemsInThe')}</p>
        )}
        <pre
          translate="no"
          class="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface px-3 py-2 font-mono text-meta text-ink"
        >
          {preview}
        </pre>
      </Card>
    </Layout>
  );
};
