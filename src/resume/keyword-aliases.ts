import { canonicalTerm } from './facts';

/*
 * Deterministic spelling variants for keyword matching (target-plan.md §4,
 * F3/F6). The model lists aliases only when it remembers to; this table is
 * unioned into every keyword at persist time (match.ts) and when a stored
 * match is loaded on the target page, so "Node.js" finds "node", "K8s" finds
 * "Kubernetes" and "PostgreSQL" finds "PGSQL" whatever the reply said.
 *
 * Membership means the SAME thing spelled differently — never a related
 * technology (Vue is not React, gotcha 11). Plurals and separator variants
 * ("front-end" / "front end" / "frontend", "APIs" / "API") are handled by
 * termPattern in src/web/public/target.mjs and do not belong here. Pure.
 */

const GROUPS: readonly (readonly string[])[] = [
  // languages and runtimes
  ['javascript', 'js', 'ecmascript'],
  ['typescript', 'ts'],
  ['node.js', 'node', 'nodejs'],
  ['go', 'golang'],
  ['c#', 'csharp', 'c sharp'],
  ['c++', 'cpp'],
  ['objective-c', 'objc'],
  ['ruby on rails', 'rails', 'ror'],
  ['.net', 'dotnet', 'dot net'],
  ['.net core', 'dotnet core'],
  ['asp.net', 'aspnet'],
  ['t-sql', 'transact-sql'],
  ['pl/sql', 'plsql'],
  ['html', 'html5'],
  ['css', 'css3'],
  ['sass', 'scss'],
  ['tailwind', 'tailwind css'],
  ['powershell', 'power shell'],
  ['yaml', 'yml'],
  ['regex', 'regexp', 'regular expression'],
  // frontend
  ['react', 'react.js'],
  ['vue', 'vue.js'],
  ['angular', 'angular.js'],
  ['express', 'express.js'],
  ['nuxt', 'nuxt.js'],
  ['ember', 'ember.js'],
  ['backbone', 'backbone.js'],
  ['d3', 'd3.js'],
  ['socket.io', 'socketio'],
  ['websocket', 'web socket'],
  ['webhook', 'web hook'],
  ['frontend', 'front end'],
  ['backend', 'back end'],
  ['fullstack', 'full stack'],
  ['pwa', 'progressive web app'],
  ['spa', 'single page application'],
  ['ssr', 'server side rendering'],
  ['seo', 'search engine optimization', 'search engine optimisation'],
  ['a11y', 'accessibility'],
  ['i18n', 'internationalization', 'internationalisation'],
  ['l10n', 'localization', 'localisation'],
  ['ui', 'user interface'],
  ['ux', 'user experience'],
  ['ui/ux', 'ux/ui'],
  // apis and auth
  ['api', 'application programming interface'],
  ['rest', 'restful'],
  ['rest api', 'restful api'],
  ['oauth', 'oauth2', 'oauth 2.0'],
  ['jwt', 'json web token'],
  ['sso', 'single sign-on'],
  ['oidc', 'openid connect'],
  ['2fa', 'two-factor authentication'],
  ['mfa', 'multi-factor authentication'],
  ['rbac', 'role-based access control'],
  ['ssl', 'tls', 'ssl/tls'],
  ['protobuf', 'protocol buffers'],
  ['openapi', 'swagger'],
  ['pub/sub', 'publish/subscribe'],
  // data
  ['postgresql', 'postgres', 'psql', 'pgsql'],
  ['mongodb', 'mongo'],
  ['sql server', 'mssql', 'ms sql', 'microsoft sql server'],
  ['dynamodb', 'dynamo db', 'amazon dynamodb'],
  ['elasticsearch', 'elastic search'],
  ['opensearch', 'open search'],
  ['orm', 'object-relational mapping'],
  ['kafka', 'apache kafka'],
  ['spark', 'apache spark'],
  ['airflow', 'apache airflow'],
  ['hadoop', 'apache hadoop'],
  ['flink', 'apache flink'],
  ['cassandra', 'apache cassandra'],
  ['solr', 'apache solr'],
  ['rabbitmq', 'rabbit mq'],
  ['activemq', 'active mq'],
  ['etl', 'extract transform load', 'extract, transform, load'],
  ['data warehouse', 'data warehousing', 'dwh'],
  ['vector database', 'vector db'],
  ['caching', 'cache'],
  ['bigquery', 'big query'],
  // ai
  ['ml', 'machine learning'],
  ['ai', 'artificial intelligence'],
  ['llm', 'large language model'],
  ['nlp', 'natural language processing'],
  ['genai', 'generative ai'],
  ['rag', 'retrieval-augmented generation'],
  ['scikit-learn', 'sklearn'],
  // cloud and infrastructure
  ['aws', 'amazon web services'],
  ['gcp', 'google cloud', 'google cloud platform'],
  ['azure', 'microsoft azure'],
  ['lambda', 'aws lambda'],
  ['s3', 'amazon s3'],
  ['ec2', 'amazon ec2'],
  ['rds', 'amazon rds'],
  ['sqs', 'amazon sqs'],
  ['ecs', 'amazon ecs'],
  ['eks', 'amazon eks'],
  ['gke', 'google kubernetes engine'],
  ['gcs', 'google cloud storage'],
  ['cloudformation', 'cloud formation'],
  ['cloudwatch', 'cloud watch'],
  ['iam', 'identity and access management'],
  ['kubernetes', 'k8s'],
  ['helm', 'helm charts'],
  ['iac', 'infrastructure as code'],
  ['cdn', 'content delivery network'],
  ['linux', 'gnu/linux'],
  ['macos', 'mac os', 'os x'],
  ['devops', 'dev ops'],
  ['sre', 'site reliability engineering', 'site reliability engineer'],
  ['on-call', 'oncall'],
  ['new relic', 'newrelic'],
  ['elk', 'elk stack', 'elastic stack'],
  ['opentelemetry', 'open telemetry', 'otel'],
  ['monorepo', 'mono repo'],
  ['load balancing', 'load balancer'],
  ['scalability', 'scalable', 'scaling'],
  ['microservices', 'micro services'],
  ['soa', 'service-oriented architecture'],
  ['performance optimization', 'performance optimisation', 'performance tuning'],
  // delivery and quality
  ['ci/cd', 'ci', 'cd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  ['github actions', 'gh actions'],
  ['gitlab ci', 'gitlab ci/cd'],
  ['circleci', 'circle ci'],
  ['travis ci', 'travis'],
  ['argocd', 'argo cd'],
  ['version control', 'source control', 'vcs'],
  ['pull request', 'merge request'],
  ['unit testing', 'unit test'],
  ['integration testing', 'integration test'],
  ['e2e', 'end-to-end'],
  ['e2e testing', 'end-to-end testing'],
  ['tdd', 'test-driven development'],
  ['bdd', 'behavior-driven development', 'behaviour-driven development'],
  ['ddd', 'domain-driven design'],
  ['qa', 'quality assurance'],
  ['automated testing', 'test automation'],
  ['a/b testing', 'split testing'],
  ['phpunit', 'php unit'],
  ['pytest', 'py.test'],
  ['penetration testing', 'pen testing', 'pentesting', 'pen test'],
  ['oop', 'object-oriented programming', 'object-oriented'],
  ['fp', 'functional programming'],
  ['solid', 'solid principles'],
  ['pci', 'pci dss'],
  ['soc 2', 'soc ii'],
  // frameworks
  ['fastapi', 'fast api'],
  ['spring', 'spring framework'],
  ['jvm', 'java virtual machine'],
  ['entity framework', 'ef core'],
  ['swiftui', 'swift ui'],
  // domains and work
  ['ecommerce', 'e-commerce'],
  ['fintech', 'financial technology'],
  ['saas', 'software as a service'],
  ['b2b', 'business-to-business'],
  ['b2c', 'business-to-consumer'],
  ['crm', 'customer relationship management'],
  ['erp', 'enterprise resource planning'],
  ['cms', 'content management system'],
  ['pos', 'point of sale'],
  ['iot', 'internet of things'],
  ['cs', 'computer science'],
  ['salesforce', 'sfdc'],
  ['startup', 'start-up'],
  ['remote', 'remotely'],
  ['wfh', 'work from home'],
  ['fulltime', 'full-time'],
  ['parttime', 'part-time'],
  ['tech lead', 'technical lead'],
  ['team lead', 'team leader'],
  ['mentoring', 'mentorship', 'mentor', 'mentored'],
];

const BY_SPELLING = new Map<string, readonly string[]>();
for (const group of GROUPS) {
  for (const spelling of group) BY_SPELLING.set(spelling, group);
}

export const ALIAS_GROUPS = GROUPS;

/** The other spellings of `term` (lowercase), or [] when the table does not know it. */
export function aliasesFor(term: string): string[] {
  const key = canonicalTerm(term);
  const group = BY_SPELLING.get(key);
  return group ? group.filter((s) => s !== key) : [];
}

/**
 * The keyword with every table spelling of its term and aliases merged into
 * `aliases`. Returns the same object when the table adds nothing.
 */
export function withTableAliases<K extends { term: string; aliases: string[] }>(k: K): K {
  const key = canonicalTerm(k.term);
  const merged = new Set(k.aliases);
  for (const name of [key, ...k.aliases]) {
    for (const alias of aliasesFor(name)) {
      if (alias !== key) merged.add(alias);
    }
  }
  return merged.size === k.aliases.length ? k : { ...k, aliases: [...merged] };
}
