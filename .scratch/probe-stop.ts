import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../src/db';
import { getResume, listOtherResumeSkills, listFacts } from '../src/resume/store';
import { buildMatchPrompt, MATCH_MAX_TOKENS } from '../src/resume/prompts';

async function main() {
  const job = await prisma.job.findUnique({ where: { id: 646 }, include: { company: { select: { name: true } } } });
  const resume = await getResume(2);
  if (!job || !resume) throw new Error('missing');
  const [facts, otherResumeSkills] = await Promise.all([listFacts(), listOtherResumeSkills(resume.id)]);
  const prompt = buildMatchPrompt(resume.text,
    { title: job.title, companyName: job.company.name, location: job.location, description: job.description },
    'full', { facts, otherResumeSkills });
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-opus-5', max_tokens: MATCH_MAX_TOKENS,
    system: [{ type: 'text', text: prompt.system }],
    messages: [{ role: 'user', content: prompt.user }],
  });
  console.log('stop_reason :', resp.stop_reason);
  console.log('usage       :', JSON.stringify(resp.usage));
  console.log('max_tokens  :', MATCH_MAX_TOKENS);
  await prisma.$disconnect();
}
void main();
