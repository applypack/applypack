import { prisma } from '../src/db';
import { getResume, listOtherResumeSkills, listFacts } from '../src/resume/store';
import { buildMatchPrompt, MATCH_MAX_TOKENS } from '../src/resume/prompts';
import { getAiRuntime } from '../src/ai-runtime';
import { extractJson } from '../src/text-utils';

async function main() {
  const job = await prisma.job.findUnique({ where: { id: 646 }, include: { company: { select: { name: true } } } });
  const resume = await getResume(2);
  if (!job || !resume) throw new Error('missing');
  const [facts, otherResumeSkills] = await Promise.all([listFacts(), listOtherResumeSkills(resume.id)]);
  console.log('facts:', facts.length, '| otherResumeSkills:', otherResumeSkills.length);
  const prompt = buildMatchPrompt(
    resume.text,
    { title: job.title, companyName: job.company.name, location: job.location, description: job.description },
    'full',
    { facts, otherResumeSkills },
  );
  console.log('system chars:', prompt.system.length, '| user chars:', prompt.user.length, '| total', prompt.system.length + prompt.user.length);
  const ai = await getAiRuntime();
  const out = await ai.complete({ ...prompt, maxTokens: MATCH_MAX_TOKENS, label: 'probe2', role: 'resume', timeoutMs: 300000 });
  if (!out) { console.log('AI returned null'); return; }
  const t = out.text;
  console.log('--- reply chars:', t.length, '| braces', (t.match(/\{/g)||[]).length, '/', (t.match(/\}/g)||[]).length);
  console.log('--- extractJson:', extractJson(t) === null ? 'NULL (FAILS)' : 'parsed OK');
  console.log('--- last 200 ---'); console.log(JSON.stringify(t.slice(-200)));
  await prisma.$disconnect();
}
void main();
