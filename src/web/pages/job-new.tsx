/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { Button, Card, Field, Flash, Hint, Input, PageHeader, Textarea } from '../ui';
import type { FlashMessage } from '../flash';
import { t } from '../../i18n/t';

export const JobNewPage: FC<{ flash?: FlashMessage | null }> = ({ flash }) => (
  <Layout title={t('job.new.pasteAJob')} active="jobs">
    <div class="w-full">
      <PageHeader title={t('job.new.pasteAJob')} back={{ href: '/jobs', label: t('job.allJobs') }}>
        {t('job.new.forPostingsTheFetchersDont')}
      </PageHeader>
      <Flash flash={flash} />

      <Card>
        <form method="post" action="/jobs/new" class="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.company')}>
            <Input type="text" name="companyName" required maxlength="200" placeholder={t('job.new.acmeCorp')} />
          </Field>
          <Field label={t('job.new.jobTitle')}>
            <Input
              type="text"
              name="title"
              required
              maxlength="200"
              placeholder={t('job.new.seniorSoftwareEngineer')}
            />
          </Field>
          <Field label={t('job.new.postingUrl')} hint={t('job.new.optionalHelpsVerificationFindThe')}>
            <Input type="url" name="url" placeholder="https://…" translate="no" />
          </Field>
          <Field
            label={t('common.location')}
            hint={t('job.new.asWrittenInThePosting')}
          >
            <Input type="text" name="location" maxlength="200" placeholder={t('job.new.remoteUs')} />
          </Field>
          <Field
            label={t('job.new.jobDescription')}
            hint={t('job.new.pasteThePostingVerbatimIt')}
            class="sm:col-span-2"
          >
            <Textarea
              name="description"
              rows={18}
              required
              minlength="200"
              placeholder={t('job.new.descriptionPlaceholder')}
            />
          </Field>
          <div class="flex items-center gap-3 sm:col-span-2">
            <Button size="lg">{t('job.new.saveJob')}</Button>
            <Hint>
              {t('job.new.runsTheClassifierOnceA')}
            </Hint>
          </div>
        </form>
      </Card>
    </div>
  </Layout>
);
