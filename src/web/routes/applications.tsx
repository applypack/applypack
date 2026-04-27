/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../../db';
import { getSettings } from '../../settings';
import { ApplicationsPage } from '../pages/applications';

const STAGE_VALUES = [
  'applied',
  'screen',
  'tech',
  'onsite',
  'offer',
  'rejected',
  'ghosted',
] as const;
type Stage = (typeof STAGE_VALUES)[number];

export const ApplicationFormSchema = z.object({
  pipelineStage: z
    .union([z.enum(STAGE_VALUES), z.literal('')])
    .optional(),
  appliedAt: z.string().optional(),
  recruiterContact: z.string().optional(),
  applicationNotes: z.string().optional(),
});

export const applicationsRoute = new Hono();

applicationsRoute.get('/applications', async (c) => {
  const settings = await getSettings();

  const rows = await prisma.job.findMany({
    where: { pipelineStage: { in: [...STAGE_VALUES] } },
    include: { company: { select: { name: true } } },
    orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
  });

  const empty: Record<Stage, []> = {
    applied: [],
    screen: [],
    tech: [],
    onsite: [],
    offer: [],
    rejected: [],
    ghosted: [],
  };
  const byStage = { ...empty } as Record<
    Stage,
    Array<{
      id: number;
      title: string;
      companyName: string;
      fitScore: number | null;
      appliedAt: Date | null;
      recruiterContact: string | null;
    }>
  >;
  for (const j of rows) {
    const stage = j.pipelineStage as Stage | null;
    if (!stage || !STAGE_VALUES.includes(stage)) continue;
    byStage[stage].push({
      id: j.id,
      title: j.title,
      companyName: j.company.name,
      fitScore: j.fitScore,
      appliedAt: j.appliedAt,
      recruiterContact: j.recruiterContact,
    });
  }

  return c.html(
    <ApplicationsPage
      byStage={byStage}
      applicationTrackingEnabled={settings.applicationTrackingEnabled}
    />,
  );
});

applicationsRoute.post('/jobs/:id/application', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.text('Bad id', 400);
  const settings = await getSettings();
  if (!settings.applicationTrackingEnabled) {
    return c.redirect(`/jobs/${id}`, 303);
  }

  const form = await c.req.parseBody();
  const parsed = ApplicationFormSchema.safeParse({
    pipelineStage: form.pipelineStage,
    appliedAt: form.appliedAt,
    recruiterContact: form.recruiterContact,
    applicationNotes: form.applicationNotes,
  });
  if (!parsed.success) {
    return c.text('Invalid form values', 400);
  }
  const { pipelineStage, appliedAt, recruiterContact, applicationNotes } =
    parsed.data;

  const stageValue =
    pipelineStage && pipelineStage.length > 0 ? pipelineStage : null;

  await prisma.job.update({
    where: { id },
    data: {
      pipelineStage: stageValue,
      appliedAt:
        appliedAt && appliedAt.length > 0 && !Number.isNaN(Date.parse(appliedAt))
          ? new Date(appliedAt)
          : null,
      recruiterContact:
        recruiterContact && recruiterContact.trim().length > 0
          ? recruiterContact.trim()
          : null,
      applicationNotes:
        applicationNotes && applicationNotes.trim().length > 0
          ? applicationNotes
          : null,
    },
  });

  return c.redirect(`/jobs/${id}`, 303);
});
