import { prisma } from '../../src/db';
import { createManualJob } from '../../src/jobs/manual-job';
import { createProfile } from '../../src/profiles';
import { setSetupCompleted, setAiEngineConfig } from '../../src/settings';
import { JobStatus } from '@prisma/client';

const DAY = 86_400_000;
const now = Date.now();

type Row = {
  company: string; title: string; location: string; fit: number; status: JobStatus;
  salary?: [number, number, string]; tech: string[]; ago: number; summary: string; description: string; flags?: string[];
};

const ROWS: Row[] = [
  { company: 'Lumen Payments', title: 'Staff Backend Engineer, Payments Platform', location: 'Remote (Europe)', fit: 88, status: 'ALERTED', salary: [150000, 180000, 'USD'], tech: ['typescript', 'nodejs', 'postgres', 'aws'], ago: 0.3,
    summary: 'Strong match: TypeScript + Node.js services over PostgreSQL on AWS, senior scope, remote across Europe. Payments domain is new but the posting asks for platform experience, not fintech years.',
    description: 'Lumen Payments runs card acquiring for 4,000 European merchants.\n\nYou will own the ledger and settlement services: Node.js and TypeScript over PostgreSQL, deployed on AWS ECS. You will design schemas, review pull requests and mentor two engineers.\n\nRequirements: 6+ years shipping production services, deep TypeScript and Node.js, PostgreSQL schema design and query tuning, Docker and CI/CD. Nice to have: Kafka, Terraform.\n\nRemote within Europe. $150k–$180k.' },
  { company: 'Northwind Labs', title: 'Senior Node.js Engineer', location: 'Lisbon, Portugal (hybrid)', fit: 86, status: 'SAVED', salary: [65000, 80000, 'EUR'], tech: ['nodejs', 'typescript', 'react', 'postgres'], ago: 1.2,
    summary: 'Good fit: Node.js + React + PostgreSQL product team in Lisbon, two office days a week. Seniority matches; the posting wants GraphQL, which the resume shows in production.',
    description: 'Northwind Labs builds inventory software for independent retailers.\n\nWe are hiring a Senior Node.js Engineer for the ordering team: Node.js, TypeScript, React, PostgreSQL, GraphQL. Hybrid in Lisbon, two days a week in the office.\n\nYou have 5+ years with Node.js in production, know PostgreSQL beyond CRUD and have shipped a React front end.\n\n€65k–€80k, 25 days leave.' },
  { company: 'Kestrel Systems', title: 'Full-Stack Engineer, Growth', location: 'Remote, EU time zones', fit: 84, status: 'APPLIED', salary: [140000, 165000, 'USD'], tech: ['typescript', 'react', 'nextjs', 'postgres'], ago: 3.1,
    summary: 'Fits the stack (TypeScript, React, Next.js, PostgreSQL) and the remote arrangement; growth-team scope leans front-end, which the Lantern Rail role covers.',
    description: 'Kestrel Systems makes analytics for logistics fleets.\n\nThe growth team ships onboarding, billing and the marketing site: Next.js, React, TypeScript, PostgreSQL, Stripe. Remote, EU time zones.\n\nRequirements: 4+ years with React and TypeScript, experience owning a feature end to end, comfort with SQL.\n\n$140k–$165k.' },
  { company: 'Tidewater', title: 'Senior Software Engineer (React + Node)', location: 'Berlin, Germany · hybrid', fit: 82, status: 'ALERTED', tech: ['react', 'nodejs', 'typescript', 'docker'], ago: 0.8,
    summary: 'Stack match on React, Node.js and TypeScript; hybrid in Berlin with three remote days. Salary not stated.',
    description: 'Tidewater builds tide and weather forecasting tools for ports.\n\nSenior Software Engineer: React, Node.js, TypeScript, Docker, PostgreSQL. Hybrid in Berlin, two office days.\n\nYou have shipped production web applications for 5+ years and like owning an area end to end.\n\nSalary on request, 30 days leave.' },
  { company: 'Praia Health', title: 'Backend Engineer, Platform', location: 'Remote, Portugal', fit: 81, status: 'NEW', salary: [55000, 70000, 'EUR'], tech: ['nodejs', 'typescript', 'postgres', 'aws'], ago: 0.1,
    summary: 'Platform role on Node.js, TypeScript and PostgreSQL on AWS, remote within Portugal. Mid-to-senior scope; the salary band sits below the other matches.',
    description: 'Praia Health runs telehealth for clinics across Portugal.\n\nBackend Engineer on the platform team: Node.js, TypeScript, PostgreSQL, AWS (ECS, RDS), Terraform. Remote within Portugal.\n\nRequirements: 4+ years with Node.js, PostgreSQL, Docker. Nice to have: healthcare data standards.\n\n€55k–€70k.' },
  { company: 'Orbital Data', title: 'Senior TypeScript Engineer', location: 'Remote worldwide', fit: 79, status: 'ALERTED', salary: [120000, 150000, 'USD'], tech: ['typescript', 'nodejs', 'graphql'], ago: 2.4,
    summary: 'TypeScript and Node.js match with GraphQL; fully remote. The posting asks for Rust for one service, which the resume does not show.',
    description: 'Orbital Data indexes satellite imagery for insurers.\n\nSenior TypeScript Engineer: Node.js services, GraphQL API, PostgreSQL, one Rust ingestion service. Remote worldwide.\n\nRequirements: 5+ years TypeScript, GraphQL in production, PostgreSQL. Nice to have: Rust, Kubernetes.\n\n$120k–$150k.' },
  { company: 'Hollis & Co', title: 'Lead Engineer, Scheduling', location: 'Remote, UK', fit: 76, status: 'NEW', salary: [85000, 100000, 'GBP'], tech: ['nodejs', 'react', 'postgres'], ago: 1.6,
    summary: 'Lead scope on a Node.js + React + PostgreSQL scheduling product; remote within the UK, which the search allows for Europe. Team-lead experience is partly shown.',
    description: 'Hollis & Co builds staff scheduling for hospitality groups.\n\nLead Engineer for the scheduling team of six: Node.js, React, PostgreSQL, Redis, AWS. Remote within the UK.\n\nRequirements: 6+ years, has led a team, PostgreSQL and Redis in production.\n\n£85k–£100k.' },
  { company: 'Bluefin Analytics', title: 'Software Engineer II (Node.js)', location: 'Remote, Spain', fit: 72, status: 'DISMISSED', salary: [48000, 60000, 'EUR'], tech: ['nodejs', 'typescript', 'postgres'], ago: 4.2,
    summary: 'Stack matches but the level (Engineer II) and the salary band sit below a senior search.',
    description: 'Bluefin Analytics builds dashboards for e-commerce sellers.\n\nSoftware Engineer II: Node.js, TypeScript, PostgreSQL, React. Remote within Spain.\n\nRequirements: 3+ years with Node.js and SQL.\n\n€48k–€60k.' },
  { company: 'Redwood Fintech', title: 'Principal Engineer', location: 'Remote, US only', fit: 66, status: 'SAVED', salary: [190000, 230000, 'USD'], tech: ['typescript', 'nodejs', 'aws'], ago: 5.3,
    summary: 'Strong stack overlap, but the posting is remote within the United States only and the search is set to Europe.', flags: ['location: US only'],
    description: 'Redwood Fintech runs lending for small businesses.\n\nPrincipal Engineer across Node.js, TypeScript and AWS. Remote, US residents only.\n\nRequirements: 10+ years, has set technical direction for 20+ engineers.\n\n$190k–$230k.' },
  { company: 'Sable Logistics', title: 'Senior Backend Engineer (Go)', location: 'Remote (EU)', fit: 55, status: 'NEW', salary: [90000, 110000, 'EUR'], tech: ['postgres', 'aws'], ago: 2.9,
    summary: 'Go is the primary language and the resume shows none; PostgreSQL and AWS overlap only.', flags: ['primary stack: Go'],
    description: 'Sable Logistics builds routing for last-mile couriers.\n\nSenior Backend Engineer: Go services, PostgreSQL, AWS, gRPC. Remote within the EU.\n\nRequirements: 5+ years with Go in production.\n\n€90k–€110k.' },
  { company: 'Wavecrest', title: 'Frontend Engineer (Vue)', location: 'Amsterdam, Netherlands (hybrid)', fit: 48, status: 'DISMISSED', tech: ['typescript'], ago: 3.7,
    summary: 'Vue is not React: the resume shows React only, and the role is front-end only in a hybrid Amsterdam office.', flags: ['primary stack: Vue'],
    description: 'Wavecrest makes booking software for surf schools.\n\nFrontend Engineer: Vue 3, TypeScript, Vite, Pinia. Hybrid in Amsterdam.\n\nRequirements: 3+ years with Vue.\n\nSalary on request.' },
  { company: 'Meridian Health', title: 'Senior Rails Engineer', location: 'Remote', fit: 41, status: 'DISMISSED', salary: [130000, 150000, 'USD'], tech: ['postgres'], ago: 6.1,
    summary: 'Ruby on Rails is the primary stack; the resume moved a product off Rails and shows no Rails work. PostgreSQL overlaps.', flags: ['primary stack: Ruby on Rails'],
    description: 'Meridian Health builds patient intake for clinics.\n\nSenior Rails Engineer: Ruby on Rails, PostgreSQL, Hotwire. Remote.\n\nRequirements: 5+ years with Rails.\n\n$130k–$150k.' },
  { company: 'Acme Robotics', title: 'Full-Stack Developer (PHP / Laravel)', location: 'Remote', fit: 35, status: 'DISMISSED', salary: [70000, 90000, 'USD'], tech: [], ago: 6.8,
    summary: 'PHP and Laravel are the primary stack; the resume shows neither. No overlap beyond general web work.', flags: ['primary stack: PHP / Laravel'],
    description: 'Acme Robotics sells warehouse robots.\n\nFull-Stack Developer: PHP 8, Laravel, Vue, MySQL. Remote.\n\nRequirements: 4+ years with Laravel.\n\n$70k–$90k.' },
];

async function main(): Promise<void> {
  await setAiEngineConfig({ order: ['claude_code'], models: {} });
  const profile = await createProfile({
    name: 'Senior full-stack (TypeScript)',
    stackRequired: ['TypeScript', 'Node.js', 'React', 'PostgreSQL'],
    roleTypes: ['full-stack', 'backend'],
    stackNiceToHave: ['Prisma', 'AWS', 'Docker', 'GraphQL'],
    stackExclude: ['junior', 'intern'],
    notes: 'Prefers product teams; async-friendly companies; European time zones.',
    seniority: ['senior', 'lead', 'staff'],
    countries: [],
    regions: ['EUROPE'],
    workplace: ['REMOTE', 'HYBRID'],
    residence: 'PT',
    relocation: 'no',
    onsiteCities: ['Lisbon'],
    minSalaryUsd: 60000,
    minFitScore: 75,
    notificationTargetId: null,
    resumeId: null,
    priorityRules: [],
  });
  await prisma.profile.update({ where: { id: profile.id }, data: { active: true } });
  for (const r of ROWS) {
    const res = await createManualJob(
      { companyName: r.company, title: r.title, url: `https://jobs.example.com/${r.company.toLowerCase().replace(/[^a-z]+/g, '-')}`, location: r.location, description: r.description },
      { classify: false },
    );
    const fetchedAt = new Date(now - r.ago * DAY);
    await prisma.job.update({
      where: { id: res.job.id },
      data: {
        fitScore: r.fit, techMatch: r.tech, redFlags: r.flags ?? [], summary: r.summary, status: r.status,
        alertedAt: r.status === 'ALERTED' ? fetchedAt : null,
        appliedAt: r.status === 'APPLIED' ? new Date(now - (r.ago - 0.5) * DAY) : null,
        pipelineStage: r.status === 'APPLIED' ? 'applied' : null,
        salaryMin: r.salary?.[0] ?? null, salaryMax: r.salary?.[1] ?? null,
        salaryCurrency: r.salary?.[2] ?? null, salaryPeriod: r.salary ? 'year' : null,
        postedAt: new Date(now - (r.ago + 0.5) * DAY), fetchedAt,
      },
    });
    await prisma.jobScore.create({
      data: { jobId: res.job.id, profileId: profile.id, fitScore: r.fit, locationMatch: !(r.flags ?? []).some((f) => f.startsWith('location')), techMatch: r.tech, redFlags: r.flags ?? [], summary: r.summary, scoredAt: fetchedAt },
    });
    console.log(`job ${res.job.id}  ${r.fit}  ${r.status}  ${r.title}`);
  }
  await setSetupCompleted();
  console.log(`profile ${profile.id} active; setup completed`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
