/** @jsxImportSource hono/jsx */
import { Layout } from '../layout';
import { Button, Empty } from '../ui';
import { t } from '../../i18n/t';
import type { MessageKey } from '../../i18n/catalog';

/**
 * What a page that is not there says (#768). A dismissed job is deleted after
 * 30 days, and a message, a bookmark or the browser's history still points at
 * it: the answer used to be two bare words and no way back.
 */
export type MissingKind = 'job' | 'page' | 'address';

/** Which of the three sentences an address gets: a job that is gone, a page that never was, an address we could not read. */
export function missingKind(status: number, path: string): MissingKind {
  if (status === 400) return 'address';
  return /^\/jobs\/\d+(?:\/|$)/.test(path) ? 'job' : 'page';
}

const WORDS: Record<MissingKind, { title: MessageKey; body: MessageKey }> = {
  job: { title: 'missing.job.title', body: 'missing.job.body' },
  page: { title: 'missing.page.title', body: 'missing.page.body' },
  address: { title: 'missing.address.title', body: 'missing.address.body' },
};

export function missingPage(kind: MissingKind) {
  const words = WORDS[kind];
  return (
    <Layout title={t(words.title)} active={kind === 'job' ? 'jobs' : undefined}>
      <div class="mx-auto w-full max-w-2xl pt-6 lg:pt-16">
        <Empty
          title={t(words.title)}
          action={
            <div class="flex flex-wrap justify-center gap-2">
              <Button href="/jobs">{t('missing.toJobs')}</Button>
              <Button href="/" variant="secondary">
                {t('missing.toOverview')}
              </Button>
            </div>
          }
        >
          {t(words.body)}
        </Empty>
      </div>
    </Layout>
  );
}
