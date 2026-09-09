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
