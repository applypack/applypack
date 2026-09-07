import { writeFileSync } from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, LevelFormat,
  Table, TableRow, TableCell, WidthType, convertInchesToTwip,
} from 'docx';
import PDFDocument from 'pdfkit';

const OUT = '.scratch/fixtures';
const FONT = 'Calibri', BODY = 21, NAME = 40, HEAD = 24, ACCENT = '1F6F4A', GREY = '555555';

const run = (t: string, o: Record<string, unknown> = {}) => new TextRun({ text: t, font: FONT, size: BODY, ...o });
const para = (kids: TextRun[], o: Record<string, unknown> = {}) => new Paragraph({ children: kids, ...o });
const head = (t: string) => para([run(t.toUpperCase(), { bold: true, size: HEAD, color: ACCENT })], {
  spacing: { before: 200, after: 60 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT, space: 1 } },
});

/* ---------- A: flow .docx, PHP/Laravel backend ---------- */
function resumeA(): Document {
  const kids: Paragraph[] = [
    para([run('Marta Kovalenko', { bold: true, size: NAME })], { alignment: AlignmentType.CENTER }),
    para([run('Senior Backend Engineer', { size: HEAD, color: GREY })], { alignment: AlignmentType.CENTER }),
    para([run('Kyiv, Ukraine · Remote · marta.kovalenko@example.com · +380 44 000 0000 · github.com/example-marta', { color: GREY })], { alignment: AlignmentType.CENTER }),
    head('Summary'),
    para([run('Backend engineer with 8 years building PHP/Laravel systems for payments and logistics. Took a monolith to 40 services without a rewrite; cut p95 checkout latency from 1.9 s to 340 ms. Comfortable owning a service from schema to on-call.')]),
    head('Skills'),
    para([run('Languages: ', { bold: true }), run('PHP, SQL, Bash, a little Go')]),
    para([run('Frameworks: ', { bold: true }), run('Laravel, Symfony, Lumen')]),
    para([run('Data: ', { bold: true }), run('PostgreSQL, MySQL, Redis, Elasticsearch')]),
    para([run('Platform: ', { bold: true }), run('Docker, Kubernetes, AWS (ECS, RDS, SQS), GitLab CI, Terraform')]),
    head('Experience'),
  ];
  const roles = [
    ['Nova Post Digital', 'Kyiv, Ukraine · Hybrid', 'Senior Backend Engineer', 'Mar 2021 – Present', [
      'Split a 400k-line Laravel monolith into 40 services over two years, keeping delivery running throughout — no feature freeze, no rewrite.',
      'Cut p95 checkout latency from 1.9 s to 340 ms by moving parcel pricing to a read model in Redis.',
      'Introduced contract tests between services, which took integration incidents from ~4 a month to under 1.',
      'Ran the on-call rotation for 12 engineers and wrote the runbooks it uses.',
    ]],
    ['Wirebox', 'Lviv, Ukraine · On-site', 'Backend Engineer', 'Jun 2018 – Mar 2021', [
      'Built the payment reconciliation service handling €40M a year across Stripe and Adyen.',
      'Replaced nightly CSV imports with an event pipeline on SQS, dropping settlement lag from 24 h to 15 min.',
      'Added PostgreSQL partitioning to a 900M-row ledger table, keeping month-end reports under 5 s.',
    ]],
  ] as const;
  for (const [co, loc, title, dates, bullets] of roles) {
    kids.push(para([run(co, { bold: true }), run(`  ${loc}`, { color: GREY })], { spacing: { before: 140 } }));
    kids.push(para([run(title, { bold: true }), run(`  ${dates}`, { color: GREY })]));
    for (const b of bullets) kids.push(para([run(b)], { numbering: { reference: 'b', level: 0 } }));
  }
  kids.push(head('Education'));
  kids.push(para([run('Taras Shevchenko National University of Kyiv', { bold: true }), run(' — B.Sc. Computer Science, 2014–2018')]));
  kids.push(head('Languages'));
  kids.push(para([run('Ukrainian (native) · English (C1) · Polish (B1)')]));
  return doc(kids, 'Marta Kovalenko');
}

/* ---------- C: structural .docx (table layout), product manager ---------- */
function resumeC(): Document {
  const cell = (kids: Paragraph[], w: number) => new TableCell({ children: kids, width: { size: w, type: WidthType.PERCENTAGE }, borders: noBorders() });
  const kids: (Paragraph | Table)[] = [
    para([run('Aisha Rahman', { bold: true, size: NAME })]),
    para([run('Senior Product Manager · London, UK · aisha.rahman@example.com · linkedin.com/in/example-aisha', { color: GREY })]),
    head('Profile'),
    para([run('Product manager with 9 years in B2B SaaS, most recently owning a £12M ARR billing platform. I work from customer interviews and usage data rather than opinion, and I have shipped three products from zero to first paying cohort.')]),
    head('Core skills'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders(),
      rows: [
        new TableRow({ children: [
          cell([para([run('Discovery', { bold: true })]), para([run('User interviews, JTBD, opportunity solution trees, usability testing')])], 50),
          cell([para([run('Delivery', { bold: true })]), para([run('Dual-track agile, story mapping, RICE, roadmapping, stakeholder comms')])], 50),
        ]}),
        new TableRow({ children: [
          cell([para([run('Data', { bold: true })]), para([run('SQL, Amplitude, Looker, A/B testing, cohort and funnel analysis')])], 50),
          cell([para([run('Tools', { bold: true })]), para([run('Figma, Jira, Linear, Notion, Miro, Productboard')])], 50),
        ]}),
      ],
    }),
    head('Experience'),
  ];
  const roles = [
    ['Ledgerly', 'London, UK · Hybrid', 'Senior Product Manager', 'Feb 2022 – Present', [
      'Own the billing platform (£12M ARR); grew net revenue retention from 104% to 118% in seven quarters.',
      'Ran 60+ customer interviews that killed a planned invoicing rebuild and redirected two quarters of engineering to dunning, which recovered £1.4M of failed payments in year one.',
      'Introduced weekly usage reviews with support and sales; time-to-first-invoice fell from 9 days to 2.',
    ]],
    ['Kettle', 'Manchester, UK · Remote', 'Product Manager', 'Aug 2018 – Feb 2022', [
      'Took the analytics module from zero to 300 paying teams in 18 months.',
      'Cut onboarding drop-off from 61% to 28% by rebuilding the first-run flow around one activation metric.',
    ]],
  ] as const;
  for (const [co, loc, title, dates, bullets] of roles) {
    kids.push(para([run(co, { bold: true }), run(`  ${loc}`, { color: GREY })], { spacing: { before: 140 } }));
    kids.push(para([run(title, { bold: true }), run(`  ${dates}`, { color: GREY })]));
    for (const b of bullets) kids.push(para([run(b)], { numbering: { reference: 'b', level: 0 } }));
  }
  kids.push(head('Education'));
  kids.push(para([run('University of Manchester', { bold: true }), run(' — B.A. Economics, 2011–2014')]));
  return doc(kids, 'Aisha Rahman');
}

function noBorders() {
  const n = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: n, bottom: n, left: n, right: n, insideHorizontal: n, insideVertical: n };
}

function doc(children: (Paragraph | Table)[], name: string): Document {
  return new Document({
    title: `${name} — Resume`, creator: name, lastModifiedBy: name,
    styles: { default: { document: { run: { font: FONT, size: BODY } } } },
    numbering: { config: [{ reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.15) } } } }] }] },
    sections: [{ properties: { page: { margin: { top: convertInchesToTwip(0.6), bottom: convertInchesToTwip(0.6), left: convertInchesToTwip(0.7), right: convertInchesToTwip(0.7) } } }, children }],
  });
}

/* ---------- B: .pdf, React/TypeScript frontend ---------- */
function resumeB(path: string) {
  const d = new PDFDocument({ size: 'A4', margins: { top: 46, bottom: 46, left: 52, right: 52 }, info: { Title: 'Tomás Ferreira — Resume', Author: 'Tomás Ferreira' } });
  d.pipe(require('node:fs').createWriteStream(path));
  const A = '#2B4C7E';
  d.font('Helvetica-Bold').fontSize(19).fillColor('#111').text('Tomás Ferreira');
  d.font('Helvetica').fontSize(10.5).fillColor('#555').text('Frontend Engineer  ·  Lisbon, Portugal  ·  tomas.ferreira@example.com  ·  github.com/example-tomas');
  d.moveDown(0.5);
  const h = (t: string) => { d.font('Helvetica-Bold').fontSize(11).fillColor(A).text(t.toUpperCase()); const y = d.y + 1; d.moveTo(52, y).lineTo(543, y).strokeColor(A).lineWidth(0.7).stroke(); d.moveDown(0.3); d.fillColor('#111'); };
  h('Summary');
  d.font('Helvetica').fontSize(10).text('Frontend engineer, 5 years, focused on design systems and rendering performance in React and TypeScript. Shipped a component library used by 6 product teams and took Largest Contentful Paint on the marketing site from 4.1 s to 1.2 s.');
  d.moveDown(0.4);
  h('Skills');
  for (const [k, v] of [['Core', 'TypeScript, JavaScript (ES2023), React 18, Next.js 14'], ['Styling', 'Tailwind CSS, CSS Modules, Radix UI, Storybook'], ['Data', 'GraphQL, Apollo Client, TanStack Query, REST'], ['Testing', 'Vitest, Testing Library, Playwright'], ['Build', 'Vite, Turborepo, pnpm, GitHub Actions']] as const) {
    d.font('Helvetica-Bold').fontSize(10).text(`${k}: `, { continued: true }).font('Helvetica').text(v);
  }
  d.moveDown(0.4);
  h('Experience');
  for (const [co, loc, title, dates, bullets] of [
    ['Unbabel', 'Lisbon, Portugal · Hybrid', 'Frontend Engineer', 'Jan 2022 – Present', [
      'Built and maintain the design system (58 components) adopted by 6 product teams; cut new-screen build time roughly in half.',
      'Took marketing-site LCP from 4.1 s to 1.2 s with route-level code splitting and an image pipeline on Next.js.',
      'Introduced Playwright coverage for the three checkout journeys, which caught 11 regressions before release in the first quarter.',
    ]],
    ['Talkdesk', 'Remote, Portugal', 'Junior Frontend Engineer', 'Sep 2020 – Jan 2022', [
      'Rebuilt the agent dashboard in React with virtualised lists, holding 60 fps at 5 000 live rows.',
      'Migrated 40 class components to hooks with no behaviour change, removing 3 100 lines.',
    ]],
  ] as const) {
    d.font('Helvetica-Bold').fontSize(10).text(co, { continued: true }).font('Helvetica').fillColor('#555').text(`  ${loc}`);
    d.fillColor('#111').font('Helvetica-Bold').text(title, { continued: true }).font('Helvetica').fillColor('#555').text(`  ${dates}`);
    d.fillColor('#111').font('Helvetica').fontSize(10);
    for (const b of bullets) d.text(`• ${b}`, { indent: 6 });
    d.moveDown(0.3);
  }
  h('Education');
  d.font('Helvetica-Bold').fontSize(10).text('Instituto Superior Técnico', { continued: true }).font('Helvetica').text(' — B.Sc. Information Systems, 2016–2020');
  d.moveDown(0.3);
  h('Languages');
  d.font('Helvetica').fontSize(10).text('Portuguese (native) · English (C1) · Spanish (B2)');
  d.end();
}

async function main() {
  writeFileSync(`${OUT}/marta-kovalenko-backend-php.docx`, await Packer.toBuffer(resumeA()));
  writeFileSync(`${OUT}/aisha-rahman-product-manager.docx`, await Packer.toBuffer(resumeC()));
  resumeB(`${OUT}/tomas-ferreira-frontend-react.pdf`);
  console.log('written');
}
void main();
