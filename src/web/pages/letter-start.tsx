/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Checkbox, FILE_INPUT_CLASS, Flash, Hint, Input, More, PageHeader, SectionTitle, Select, Textarea } from '../ui';
import type { FlashMessage } from '../flash';
import type { ResumeOption } from '../resume-source';
import type { JobPickOption } from '../job-pick';
import { JobPicker } from './job-picker';
import { MineCheckbox, ModeCard } from './target-start';
import { toneLabel } from './cover-letter-card';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MAX_UPLOAD_MB } from '../upload';
import { COVER_TONES, type CoverAngles } from '../../resume/prompts';
import { t } from '../../i18n/t';

/*
 * The /letter launcher (F8.3): two job modes — a searchable picker over
 * tracked jobs, or one "new posting" box that takes a URL, pasted text, or
 * both. The default path is deliberately the fast one: no classification, no
 * match, no research — one model call and the letter.
 */

export interface LetterStartProps {
  jobs: JobPickOption[];
  resumes: ResumeOption[];
  angles: CoverAngles;
  /** Prefilled after a failed fetch, so the URL survives the round trip. */
  presetUrl?: string;
  flash?: FlashMessage | null;
}

export const LetterStartPage: FC<LetterStartProps> = ({
  jobs,
  resumes,
  angles,
  presetUrl = '',
  flash,
}) => {
  const hasResumes = resumes.length > 0;
  const hasJobs = jobs.length > 0;
  const newPostingFirst = !hasJobs || presetUrl.length > 0;
  const defaultResumeId = (resumes.find((r) => r.isDefault) ?? resumes[0])?.id;
  return (
    <Layout title={t('nav.letter')} active="letter">
      <PageHeader title={t('nav.letter')} meta={t('letter.start.howLong')}>
        {t('letter.aShortLetterGroundedIn')}
      </PageHeader>
      <Flash flash={flash} />

      <form id="letter-form" method="post" action="/letter" enctype="multipart/form-data" class="w-full">
        <input type="hidden" name="saveAngles" value="1" />
        <div class="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle>{t('letter.jobPosting')}</SectionTitle>
            <div class="space-y-2">
              <ModeCard
                name="jobMode"
                value="existing"
                label={t('letter.oneOfYourJobs')}
                checked={!newPostingFirst}
                disabled={!hasJobs}
              >
                {hasJobs ? (
                  <JobPicker jobs={jobs}>{t('letter.start.pickerTail')}</JobPicker>
                ) : (
                  <Hint>{t('letter.noTrackedJobsYetUse')}</Hint>
                )}
              </ModeCard>

              <ModeCard name="jobMode" value="new" label={t('letter.aNewPosting')} checked={newPostingFirst}>
                <div class="space-y-3">
                  <Input
                    type="url"
                    name="jobUrl"
                    value={presetUrl}
                    placeholder={t('letter.postingUrlWeReadThe')}
                    aria-label={t('letter.postingUrl')}
                  />
                  <Textarea
                    name="description"
                    rows={7}
                    placeholder={t('letter.start.pastePosting')}
                    aria-label={t('letter.start.jobDescription')}
                  />
                  <div class="grid gap-3 sm:grid-cols-2">
                    <Input type="text" name="companyName" maxlength="200" placeholder={t('letter.companyOptional')} aria-label={t('common.company')} />
                    <Input type="text" name="title" maxlength="200" placeholder={t('letter.jobTitleOptional')} aria-label={t('letter.jobTitle')} />
                  </div>
                  <Hint>
                    {t('letter.aUrlAloneIsEnough')}
                  </Hint>
                  <More summary={t('letter.whenAPageCannotBe')}>
                    {t('letter.sitesThatNeedJavascriptOr')}
                  </More>
                </div>
              </ModeCard>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t('letter.resume')}</SectionTitle>
            <div class="space-y-2">
              <ModeCard value="existing" label={t('letter.oneOfYourResumes')} checked={hasResumes} disabled={!hasResumes}>
                {hasResumes ? (
                  <Select name="resumeId" aria-label={t('letter.resume')}>
                    {resumes.map((r) => (
                      <option value={r.id} selected={r.id === defaultResumeId} translate="no">
                        {r.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Hint>{t('letter.nothingUploadedYetUseOne')}</Hint>
                )}
              </ModeCard>

              <ModeCard value="upload" label={t('letter.uploadAFile')} checked={!hasResumes}>
                <div class="space-y-3">
                  <Input
                    type="file"
                    name="file"
                    accept={ACCEPTED_EXTENSIONS.join(',')}
                    aria-label={t('letter.resumeFile')}
                    class={FILE_INPUT_CLASS}
                    data-required
                  />
                  <Input type="text" name="uploadName" maxlength="100" placeholder={t('letter.nameOptionalTakenFromThe')} aria-label={t('letter.resumeName')} />
                  <Hint>{t('letter.start.uploadHint', { types: ACCEPTED_EXTENSIONS.join(', '), mb: MAX_UPLOAD_MB })}</Hint>
                </div>
              </ModeCard>

              <ModeCard value="paste" label={t('letter.pasteResumeText')}>
                <div class="space-y-3">
                  <Input type="text" name="pasteName" maxlength="100" placeholder={t('letter.nameOptional')} aria-label={t('letter.resumeName')} />
                  <Textarea name="resumeText" rows={6} placeholder={t('letter.start.pasteResume')} aria-label={t('letter.start.resumeText')} data-required />
                </div>
              </ModeCard>
            </div>
            <MineCheckbox />
          </Card>
        </div>

        <Card class="mt-4">
          <SectionTitle>{t('letter.theLetter')}</SectionTitle>
          <div class="space-y-3">
            <div class="flex flex-wrap items-end gap-4">
              <label class="block">
                <span class="block text-label text-ink">{t('letter.tone')}</span>
                <Select name="tone" class="mt-1.5 !w-auto">
                  {COVER_TONES.map((tone) => (
                    <option value={tone} selected={tone === 'warm'}>
                      {toneLabel(tone)}
                    </option>
                  ))}
                </Select>
              </label>
              <Button size="lg" variant="violet">
                {t('letter.writeTheLetter')}
              </Button>
            </div>

            <div class="grid gap-2.5 sm:grid-cols-3">
              <label class="block">
                <span class="block text-meta text-ink-muted">{t('letter.whyThisCompany')}</span>
                <Input name="whyCompany" maxlength="300" class="mt-1 !text-meta" value={angles.whyCompany ?? ''} />
              </label>
              <label class="block">
                <span class="block text-meta text-ink-muted">{t('letter.whatProblemYoudSolve')}</span>
                <Input name="problem" maxlength="300" class="mt-1 !text-meta" value={angles.problem ?? ''} />
              </label>
              <label class="block">
                <span class="block text-meta text-ink-muted">{t('letter.yourApproach')}</span>
                <Input name="approach" maxlength="300" class="mt-1 !text-meta" value={angles.approach ?? ''} />
              </label>
            </div>
            <label class="block">
              <span class="block text-meta text-ink-muted">{t('letter.anythingEveryLetterShouldMention')}</span>
              <Textarea name="notes" rows={2} maxlength="500" class="mt-1 !text-meta" placeholder={t('letter.start.notesPlaceholder')}>
                {angles.notes ?? ''}
              </Textarea>
            </label>
            <Hint>
              {t('letter.savedForYourNextLetters')}
            </Hint>

            <details class="rounded-md border border-line px-3 py-2">
              <summary class="cursor-pointer text-note font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
                {t('letter.analyzeFirstSlowerSharper')}
              </summary>
              <div class="mt-2.5 space-y-2">
                <Checkbox name="runMatch" value="1">
                  {t('letter.scoreThisResumeAgainstThe')}
                </Checkbox>
                <Checkbox name="runVerify" value="1">
                  {t('letter.researchTheCompanyFirst2')}
                </Checkbox>
                <Hint>
                  {t('letter.bothAreStoredOnThe')}
                </Hint>
              </div>
            </details>
          </div>
        </Card>
      </form>
      <script type="module" dangerouslySetInnerHTML={{ __html: BOOT_JS }} />
    </Layout>
  );
};

const BOOT_JS = `
import { init } from '/static/launcher.mjs';
init();
`;
