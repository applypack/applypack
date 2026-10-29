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
  bigquery: 'BigQuery',
  'c#': 'C#',
  'c++': 'C++',
  'ci/cd': 'CI/CD',
  claude: 'Claude',
  cloudformation: 'CloudFormation',
  cloudwatch: 'CloudWatch',
  css: 'CSS',
  css3: 'CSS3',
  devops: 'DevOps',
  django: 'Django',
  docker: 'Docker',
  dynamodb: 'DynamoDB',
  ec2: 'EC2',
  ecs: 'ECS',
  eks: 'EKS',
  elasticsearch: 'Elasticsearch',
  elixir: 'Elixir',
  etl: 'ETL',
  express: 'Express',
  fastapi: 'FastAPI',
  flutter: 'Flutter',
  gcp: 'GCP',
  git: 'Git',
  github: 'GitHub',
  'github actions': 'GitHub Actions',
  gitlab: 'GitLab',
  'gitlab ci': 'GitLab CI',
  go: 'Go',
  golang: 'Go',
  'google cloud': 'Google Cloud',
  graphql: 'GraphQL',
  grpc: 'gRPC',
  html: 'HTML',
  html5: 'HTML5',
  iam: 'IAM',
  ios: 'iOS',
  java: 'Java',
  javascript: 'JavaScript',
  jquery: 'jQuery',
  js: 'JavaScript',
  json: 'JSON',
  jwt: 'JWT',
  k8s: 'Kubernetes',
  kafka: 'Kafka',
  kotlin: 'Kotlin',
  kubernetes: 'Kubernetes',
  laravel: 'Laravel',
  linux: 'Linux',
  llm: 'LLM',
  macos: 'macOS',
  mariadb: 'MariaDB',
  ml: 'ML',
  mongodb: 'MongoDB',
  mssql: 'MSSQL',
  mysql: 'MySQL',
  nestjs: 'NestJS',
  'next.js': 'Next.js',
  nextjs: 'Next.js',
  nlp: 'NLP',
  node: 'Node.js',
  'node.js': 'Node.js',
  nodejs: 'Node.js',
  nosql: 'NoSQL',
  nuxt: 'Nuxt',
  oauth: 'OAuth',
  openai: 'OpenAI',
  php: 'PHP',
  phpunit: 'PHPUnit',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  python: 'Python',
  pytorch: 'PyTorch',
  qa: 'QA',
  rabbitmq: 'RabbitMQ',
  rails: 'Rails',
  rds: 'RDS',
  react: 'React',
  'react native': 'React Native',
  redis: 'Redis',
  rest: 'REST',
  ruby: 'Ruby',
  'ruby on rails': 'Ruby on Rails',
  rust: 'Rust',
  s3: 'S3',
  saas: 'SaaS',
  scala: 'Scala',
  scss: 'SCSS',
  sns: 'SNS',
  'spring boot': 'Spring Boot',
  sql: 'SQL',
  sqlite: 'SQLite',
  sqs: 'SQS',
  sre: 'SRE',
  svelte: 'Svelte',
  swift: 'Swift',
  symfony: 'Symfony',
  tailwind: 'Tailwind',
  tdd: 'TDD',
  tensorflow: 'TensorFlow',
  terraform: 'Terraform',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  ui: 'UI',
  ux: 'UX',
  vue: 'Vue.js',
  'vue.js': 'Vue.js',
  wordpress: 'WordPress',
  xml: 'XML',
  yaml: 'YAML',
};

export function techLabel(tag: string): string {
  const key = tag.trim().toLowerCase();
  const known = LABELS[key] ?? LABELS[key.replace(/-/g, ' ')];
  if (known) return known;
  // A tag that already carries a capital was written by someone who knew how.
  if (tag.trim() !== key) return tag.trim();
  // "github-actions", "aws-lambda": a name this table spells, then the rest of
  // the product's name. "full-stack" opens with no such name and stays a word.
  const [head = '', ...rest] = key.split(/[-\s]+/);
  if (rest.length > 0 && LABELS[head]?.toLowerCase() === head) return [LABELS[head], ...rest.map(capital)].join(' ');
  return capital(key);
}

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

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
