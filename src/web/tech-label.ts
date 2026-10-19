/*
 * A technology as people write it (pure). The classifier's `tech_match` tags
 * are lowercase ("typescript", "node", "aws"); a chip or a bar says
 * TypeScript, Node.js, AWS. A tag this table has never heard of keeps its
 * letters and takes a capital, which is right more often than not.
 */
const LABELS: Readonly<Record<string, string>> = {
  '.net': '.NET',
  ai: 'AI',
  angular: 'Angular',
  api: 'API',
  aws: 'AWS',
  azure: 'Azure',
  'c#': 'C#',
  'c++': 'C++',
  'ci/cd': 'CI/CD',
  claude: 'Claude',
  css: 'CSS',
  css3: 'CSS3',
  django: 'Django',
  docker: 'Docker',
  elasticsearch: 'Elasticsearch',
  elixir: 'Elixir',
  express: 'Express',
  fastapi: 'FastAPI',
  flutter: 'Flutter',
  gcp: 'GCP',
  git: 'Git',
  github: 'GitHub',
  gitlab: 'GitLab',
  go: 'Go',
  golang: 'Go',
  graphql: 'GraphQL',
  html: 'HTML',
  html5: 'HTML5',
  ios: 'iOS',
  java: 'Java',
  javascript: 'JavaScript',
  jquery: 'jQuery',
  js: 'JavaScript',
  k8s: 'Kubernetes',
  kafka: 'Kafka',
  kotlin: 'Kotlin',
  kubernetes: 'Kubernetes',
  laravel: 'Laravel',
  linux: 'Linux',
  llm: 'LLM',
  ml: 'ML',
  mongodb: 'MongoDB',
  mysql: 'MySQL',
  nestjs: 'NestJS',
  'next.js': 'Next.js',
  nextjs: 'Next.js',
  node: 'Node.js',
  'node.js': 'Node.js',
  nodejs: 'Node.js',
  nosql: 'NoSQL',
  nuxt: 'Nuxt',
  openai: 'OpenAI',
  php: 'PHP',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  python: 'Python',
  rabbitmq: 'RabbitMQ',
  rails: 'Rails',
  react: 'React',
  'react native': 'React Native',
  redis: 'Redis',
  rest: 'REST',
  ruby: 'Ruby',
  rust: 'Rust',
  saas: 'SaaS',
  scala: 'Scala',
  sql: 'SQL',
  svelte: 'Svelte',
  swift: 'Swift',
  symfony: 'Symfony',
  tailwind: 'Tailwind',
  terraform: 'Terraform',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  vue: 'Vue.js',
  'vue.js': 'Vue.js',
  wordpress: 'WordPress',
};

export function techLabel(tag: string): string {
  const key = tag.trim().toLowerCase();
  const known = LABELS[key];
  if (known) return known;
  // A tag that already carries a capital was written by someone who knew how.
  if (tag !== key) return tag.trim();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** A posting's tags as a row shows them: "go" and "golang" are one Go, never "Go · Go" (#572). */
export function techLabels(tags: readonly string[]): string[] {
  return [...new Set(tags.filter((tag) => tag.trim().length > 0).map(techLabel))];
}

/**
 * The one key a technology is counted and filtered by: "node", "nodejs" and
 * "node.js" are the same bar on the Overview, not three with the count split.
 */
export function techKey(tag: string): string {
  return techLabel(tag).toLowerCase();
}
