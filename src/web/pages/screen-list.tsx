/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout';
import { ActionForm, Badge, Button, Card, Empty, Flash, Hint, PageHeader, Table, Td, Tr } from '../ui';
import type { FlashMessage } from '../flash';
import { formatDateShort, formatRelative } from '../format';
import type { ScreeningSummary } from '../../screening/store';

/*
 * /screen — every screening this install holds. The first sentence on the
 * page is the product rule (hr-screening-plan.md ground rules): the tool
 * ranks, a person decides.
 */

export const ScreenListPage: FC<{ screenings: ScreeningSummary[]; flash?: FlashMessage | null }> = ({ screenings, flash }) => (
  <Layout title="Screening" active="screen">
    <PageHeader
      title="Screening"
      meta={`${screenings.length} screening${screenings.length === 1 ? '' : 's'}`}
      actions={<Button href="/screen/new">New screening</Button>}
    >
      A folder of resumes against one position, read for evidence rather than words. The result is an
      order to talk to people in, with the quotes behind every mark — the decision stays with you, and the
      model never sees a name.
    </PageHeader>
    <Flash flash={flash} />

    {screenings.length === 0 ? (
      <Empty>
        No screenings yet. Start one with a position — one of your jobs, a pasted posting or a file —
        then drop the applicants' resumes in.
      </Empty>
    ) : (
      <Card flush>
        <Table
          columns={['Screening', 'Position', 'Applicants', 'Scored', 'Created', 'Kept until', '']}
          hideBelow={['', 'md', '', '', 'lg', 'sm', '']}
        >
          {screenings.map((s) => (
            <Tr>
              <Td>
                <a href={`/screen/${s.id}`} class="font-medium text-ink hover:underline">
                  {s.title}
                </a>
              </Td>
              <Td class="text-ink-muted">
                <a href={`/jobs/${s.jobId}`} class="hover:underline">
                  {s.jobTitle}
                </a>{' '}
                <span class="text-ink-faint">· {s.companyName}</span>
              </Td>
              <Td class="tabular-nums">
                {s.applicants}
                {s.unread > 0 && (
                  <span class="text-ink-faint" title="Could not be read, or a copy of another applicant">
                    {' '}
                    ({s.unread} unread)
                  </span>
                )}
              </Td>
              <Td>
                {s.applicants === 0 ? (
                  <span class="text-ink-faint">—</span>
                ) : s.scored === s.applicants - s.unread ? (
                  <Badge tone="ok">all {s.scored}</Badge>
                ) : (
                  <Badge tone="neutral">
                    {s.scored} of {s.applicants - s.unread}
                  </Badge>
                )}
              </Td>
              <Td class="text-ink-faint" title={s.createdAt.toISOString()}>
                {formatRelative(s.createdAt)}
              </Td>
              <Td class="text-ink-faint">{formatDateShort(s.retainUntil)}</Td>
              <Td class="text-right">
                <ActionForm
                  action={`/screen/${s.id}/delete`}
                  confirm={`Delete "${s.title}" with every applicant file and verdict? This cannot be undone.`}
                  class="justify-end"
                >
                  <Button variant="ghost" size="sm">
                    Delete
                  </Button>
                </ActionForm>
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>
    )}
    <Hint class="mt-4">
      Each screening is deleted with its files on the date in "Kept until" — set the default on Settings →
      Screening, or extend one from its page.
    </Hint>
  </Layout>
);
