/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, FILE_INPUT_CLASS, Flash, Hint, Input, PageHeader, SectionTitle, SUBMIT_ONCE, Textarea } from '../ui';
import type { FlashMessage } from '../flash';
import type { JobPickOption } from '../job-pick';
import { JobPicker } from './job-picker';
import { ModeCard } from './target-start';
import { ACCEPTED_EXTENSIONS } from '../../resume/resume-text';
import { MIN_DESCRIPTION_CHARS } from '../../jobs/manual-job';
import { MAX_UPLOAD_MB } from '../upload';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

/*
 * /screen/new — the position. One of the jobs already stored (pasted ones
 * first, they are the likeliest), a pasted posting, or a posting as a file.
 * Nothing about applicants yet: they are added on the screening's page,
 * after the rubric has been read off the posting.
 */

const NEXT_STEPS = ['screen.new.step.read', 'screen.new.step.edit', 'screen.new.step.drop', 'screen.new.step.score'] as const;

export const ScreenNewPage: FC<{ jobs: JobPickOption[]; flash?: FlashMessage | null }> = ({ jobs, flash }) => {
  const hasJobs = jobs.length > 0;
  return (
    <Layout title={t('screen.new.title')} active="screen">
      <PageHeader title={t('screen.new.title')} back={{ href: '/screen', label: t('nav.screen') }}>
        {t('screen.new.intro')}
      </PageHeader>
      <Flash flash={flash} />

      <form id="screen-form" method="post" action="/screen" enctype="multipart/form-data" class="w-full" onsubmit={SUBMIT_ONCE}>
        <div class="grid items-start gap-4 lg:grid-cols-2">
          <Card class="min-w-0">
            <SectionTitle>{t('screen.new.position')}</SectionTitle>
            <div class="space-y-2">
              <ModeCard name="jobMode" value="existing" label={t('screen.new.oneOfYourJobs')} checked={hasJobs} disabled={!hasJobs}>
                {hasJobs ? (
                  <JobPicker jobs={jobs}>{t('screen.new.pickerTail')}</JobPicker>
                ) : (
                  <Hint>{t('screen.new.noJobs')}</Hint>
                )}
              </ModeCard>

              <ModeCard name="jobMode" value="new" label={t('screen.new.newPosting')} checked={!hasJobs}>
                <div class="space-y-3">
                  <div class="grid gap-3 sm:grid-cols-2">
                    <Input type="text" name="title" maxlength="200" placeholder={t('screen.new.titlePlaceholder')} aria-label={t('screen.new.titleLabel')} data-required />
                    <Input type="text" name="companyName" maxlength="200" placeholder={t('screen.new.companyPlaceholder')} aria-label={t('common.company')} />
                  </div>
                  <Input type="text" name="location" maxlength="200" placeholder={t('screen.new.locationPlaceholder')} aria-label={t('common.location')} />
                  <Textarea name="description" rows={9} placeholder={t('screen.new.descriptionPlaceholder')} aria-label={t('screen.new.descriptionLabel')} />
                  <div class="flex flex-wrap items-center gap-3">
                    <input
                      type="file"
                      name="file"
                      accept={ACCEPTED_EXTENSIONS.join(',')}
                      aria-label={t('screen.new.fileLabel')}
                      // A bare file input keeps its intrinsic width and pushed the page sideways at 375 px.
                      class={`min-w-0 max-w-full text-sm text-ink-muted ${FILE_INPUT_CLASS}`}
                    />
                    <Hint>
                      {t('screen.new.fileHint', { formats: ACCEPTED_EXTENSIONS.join(' / '), mb: MAX_UPLOAD_MB, chars: MIN_DESCRIPTION_CHARS })}
                    </Hint>
                  </div>
                </div>
              </ModeCard>
            </div>
          </Card>

          <Card>
            <SectionTitle>{t('screen.new.next')}</SectionTitle>
            <ol class="list-decimal space-y-2 pl-5 text-sm text-ink-muted">
              {NEXT_STEPS.map((key) => (
                <li>{tRich(key, {}, { strong: (words) => <span class="text-ink">{words}</span> })}</li>
              ))}
            </ol>
            <div class="mt-5 flex items-center gap-3">
              <Button>{t('screen.new.create')}</Button>
              <Hint>{t('screen.new.createHint')}</Hint>
            </div>
          </Card>
        </div>
      </form>
      <script type="module" dangerouslySetInnerHTML={{ __html: "import { init } from '/static/launcher.mjs'; init();" }} />
    </Layout>
  );
};
