import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePdfText } from './pdf-text';

test('normalizePdfText joins the page-width wraps a text layer leaves, and nothing else', () => {
  const layer = [
    'PROFESSIONAL EXPERIENCE',
    'V Shred Austin, Texas, US ∙ Remote',
    'Senior Software Engineer Dec. 2024 – Present',
    '• Combined Snyk/Dependabot with Claude AI to detect vulnerabilities and prevent security issues (SQL',
    'injection, input handling), reducing risks by 40%+.',
    'Technology Stack: Node, Go, Typescript, React, Cypress, PHP, Lumen, Pest, MySQL, S3, EC2, RDS, CloudWatch,',
    'Braintree, Datadog Monitoring, Memcached.',
    'KEY SKILLS',
    'Programming:',
    'Go, PHP, JavaScript, TypeScript, SQL, PGSQL, HTML5, CSS3',
    'Node.js, Symfony, React, Vue, Laravel, Lumen, Phalcon',
    'OpenAI, Claude, AWS Bedrock, Prompt Engineering, RAG, Vector Search, AI Agents,',
    'LLM Integrations, Cursor, Windsurf',
    '',
    '',
    'EDUCATION  ',
  ].join('\n');
  assert.deepEqual(normalizePdfText(layer).split('\n'), [
    'PROFESSIONAL EXPERIENCE',
    'V Shred Austin, Texas, US ∙ Remote',
    'Senior Software Engineer Dec. 2024 – Present',
    '• Combined Snyk/Dependabot with Claude AI to detect vulnerabilities and prevent security issues (SQL injection, input handling), reducing risks by 40%+.',
    'Technology Stack: Node, Go, Typescript, React, Cypress, PHP, Lumen, Pest, MySQL, S3, EC2, RDS, CloudWatch, Braintree, Datadog Monitoring, Memcached.',
    'KEY SKILLS',
    'Programming:',
    'Go, PHP, JavaScript, TypeScript, SQL, PGSQL, HTML5, CSS3',
    'Node.js, Symfony, React, Vue, Laravel, Lumen, Phalcon',
    'OpenAI, Claude, AWS Bedrock, Prompt Engineering, RAG, Vector Search, AI Agents, LLM Integrations, Cursor, Windsurf',
    '',
    'EDUCATION',
  ]);
});

test('normalizePdfText keeps a contact line apart from the title above it', () => {
  // The clean PDF's own header, read back: the title has no full stop and the address opens lower-case.
  const layer = 'Dana Ruiz\nSenior Full-Stack Developer\ndana.ruiz@example.com · github.com/danaruiz-dev\nSUMMARY';
  assert.deepEqual(normalizePdfText(layer).split('\n'), [
    'Dana Ruiz',
    'Senior Full-Stack Developer',
    'dana.ruiz@example.com · github.com/danaruiz-dev',
    'SUMMARY',
  ]);
});

test('normalizePdfText joins a wrap whose second half opens with a capital (#637)', () => {
  // The clean PDF ApplyPack renders, read back: two page-width wraps, both onto a capitalised word.
  const layer = [
    'SUMMARY',
    'Backend-leaning software engineer with six years building scalable services in TypeScript, JavaScript, and',
    'Node.js. Designed PostgreSQL schemas and SQL migrations that cut a monthly invoicing run from 35 minutes',
    'to 5, and ran on-call for production systems serving 1.8M requests/day.',
    'SKILLS',
    'TypeScript, JavaScript, Node.js (Fastify, Express), React, Next.js, SQL, PostgreSQL, Prisma, Docker, GitHub',
    'Actions, REST, GraphQL, JSON, Jest, AWS (ECS, RDS, S3)',
    'EXPERIENCE',
  ].join('\n');
  assert.deepEqual(normalizePdfText(layer).split('\n'), [
    'SUMMARY',
    'Backend-leaning software engineer with six years building scalable services in TypeScript, JavaScript, and Node.js. Designed PostgreSQL schemas and SQL migrations that cut a monthly invoicing run from 35 minutes to 5, and ran on-call for production systems serving 1.8M requests/day.',
    'SKILLS',
    'TypeScript, JavaScript, Node.js (Fastify, Express), React, Next.js, SQL, PostgreSQL, Prisma, Docker, GitHub Actions, REST, GraphQL, JSON, Jest, AWS (ECS, RDS, S3)',
    'EXPERIENCE',
  ]);
});

test('normalizePdfText joins a list cut inside a name it does not know, only at the page width', () => {
  const layer = [
    '• Combined Snyk/Dependabot with Claude AI to detect vulnerabilities and prevent security issues in the API',
    'OpenAI, Claude, AWS Bedrock, Prompt Engineering, RAG, Vector Search, AI Agents, LLM Integrations, Datadog',
    'Monitoring, Cursor, Windsurf',
    'Go, PHP, JavaScript, TypeScript, SQL, PGSQL, HTML5, CSS3',
    'Node.js, Symfony, React, Vue, Laravel, Lumen, Phalcon',
    'Languages: Go, PHP, JavaScript, TypeScript, SQL, PGSQL, HTML5, CSS3, Python, Ruby, Elixir, Kotlin, Swift',
    'Frameworks: React, Vue, Laravel',
  ].join('\n');
  assert.deepEqual(normalizePdfText(layer).split('\n'), [
    '• Combined Snyk/Dependabot with Claude AI to detect vulnerabilities and prevent security issues in the API',
    'OpenAI, Claude, AWS Bedrock, Prompt Engineering, RAG, Vector Search, AI Agents, LLM Integrations, Datadog Monitoring, Cursor, Windsurf',
    // Short of the margin, a line of terms is a group of its own, and a labelled line always opens one.
    'Go, PHP, JavaScript, TypeScript, SQL, PGSQL, HTML5, CSS3',
    'Node.js, Symfony, React, Vue, Laravel, Lumen, Phalcon',
    'Languages: Go, PHP, JavaScript, TypeScript, SQL, PGSQL, HTML5, CSS3, Python, Ruby, Elixir, Kotlin, Swift',
    'Frameworks: React, Vue, Laravel',
  ]);
});
