import { prisma } from '../src/db';
import { getResume } from '../src/resume/store';
import { buildMatchPrompt, MATCH_MAX_TOKENS } from '../src/resume/prompts';
import { getAiRuntime } from '../src/ai-runtime';
import { extractJson } from '../src/text-utils';

async function main() {
  const job = await prisma.job.findUnique({ where: { id: 646 }, include: { company: { select: { name: true } } } });
  const resume = await getResume(2);
  if (!job || !resume) throw new Error('missing');
  const prompt = buildMatchPrompt(
    resume.text,
    { title: job.title, companyName: job.company.name, location: job.location, description: job.description },
    'full',
  );
  console.log('system chars:', prompt.system.length, '| user chars:', prompt.user.length);
  console.log('MATCH_MAX_TOKENS:', MATCH_MAX_TOKENS);
  const ai = await getAiRuntime();
  const out = await ai.complete({ ...prompt, maxTokens: MATCH_MAX_TOKENS, label: 'probe', role: 'resume', timeoutMs: 300000 });
  if (!out) { console.log('AI returned null'); return; }
  const t = out.text;
  console.log('--- reply chars:', t.length);
  console.log('--- last 300 chars ---');
  console.log(JSON.stringify(t.slice(-300)));
  console.log('--- braces: open', (t.match(/\{/g) || []).length, 'close', (t.match(/\}/g) || []).length);
  console.log('--- extractJson:', extractJson(t) === null ? 'NULL (fails)' : 'parsed OK');
  await prisma.$disconnect();
}
void main();
