/** @jsxImportSource hono/jsx */
import type { Child, FC } from 'hono/jsx';
import type { ParsedView } from '../parsed-view';
import { Badge } from '../ui';
import { t } from '../../i18n/t';
import { tRich } from '../rich';

/** What the reader took from the file — a name, an address, a heading — stays as the file wrote it. */
const asWritten = (words: Child) => <span translate="no">{words}</span>;

/**
 * What a plain parser pulls out of the text (TASKS R12): the name, the
 * contacts, the sections and the roles with their dates. A part missing here
 * is a part an ATS is likely to miss too; a role without dates is the one a
 * recruiter's filter drops. On /resumes/:id and on the two-format comparison.
 */
export const ParsedViewBlock: FC<{ view: ParsedView }> = ({ view }) => (
  <div class="mb-4 space-y-3 text-sm">
    <div class="flex flex-wrap items-baseline gap-x-2">
      <span class="text-entity text-ink">{view.name ? asWritten(view.name) : t('parsed.noNameFound')}</span>
      {view.headline && (
        <span class="text-ink-muted" translate="no">
          {view.headline}
        </span>
      )}
    </div>
    <div class="flex flex-wrap gap-1.5">
      {view.contacts.map((c) => (
        <Badge tone={c.value ? 'ok' : 'warn'}>
          {c.value
            ? tRich('parsed.contactFound', { label: c.label, value: c.value }, { v: asWritten })
            : t('parsed.contactMissing', { label: c.label })}
        </Badge>
      ))}
    </div>
    <div>
      <span class="text-ink-muted">{t('parsed.sections')} </span>
      <span class="text-ink">
        {view.sections.length > 0
          ? view.sections.map((section, i) => (
              <>
                {i > 0 && ' · '}
                {i >= view.sections.length - view.ownHeadings ? asWritten(section) : section}
              </>
            ))
          : t('parsed.noneRecognised')}
      </span>
    </div>
    {view.roles.length > 0 && (
      <ul class="space-y-1">
        {view.roles.map((r) => (
          <li class="flex flex-wrap items-center gap-2">
            <span class="text-ink" translate="no">
              {r.company ? `${r.title}, ${r.company}` : r.title}
            </span>
            {r.dates ? (
              <span class="text-meta text-ink-faint" translate="no">
                {r.dates}
              </span>
            ) : (
              <Badge tone="warn">{t('parsed.noDates')}</Badge>
            )}
            <span class="text-meta text-ink-faint">{t('parsed.bullets', { n: r.bullets })}</span>
          </li>
        ))}
      </ul>
    )}
    {view.education.length > 0 && (
      <div class="text-ink-muted">
        {tRich(
          'parsed.education',
          { list: view.education.map((e) => (e.dates ? `${e.title} (${e.dates})` : e.title)).join(' · ') },
          { v: asWritten },
        )}
      </div>
    )}
  </div>
);
