# ApplyPack — Multi-Provider AI Architecture
## Claude + OpenAI / GPT + Gemini subscriptions, API keys, routing, fallback, usage and cost tracking

**Research date:** 2026-08-29

---

# 1. Executive summary

The project should stop treating AI access as a single `.env` credential and instead introduce a first-class **AI Connections + Routing** subsystem.

The important architectural distinction is not simply:

```text
Claude
OpenAI
Gemini
```

It is:

```text
Provider
    └── Connection
            ├── Subscription / official CLI authentication
            ├── API key / pay-as-you-go
            └── Cloud-provider authentication
```

A user may legitimately have several connections at the same time:

```text
Claude
├── Claude Code subscription
└── Anthropic API key

OpenAI
├── ChatGPT / Codex subscription
└── OpenAI API key

Google
├── Google AI Pro/Ultra through Gemini CLI
├── Gemini API key
└── Vertex AI
```

The application should allow these connections to coexist without one credential silently overriding another.

The recommended end state is:

```text
ApplyPack
    |
    v
AI Orchestrator
    |
    +--> Routing Policy
    |      ├── Single provider
    |      ├── Ordered fallback
    |      ├── Subscription-first
    |      ├── Cost-aware
    |      └── Compare / parallel
    |
    +--> Provider Adapters
    |      ├── Claude Code CLI
    |      ├── Anthropic API
    |      ├── Codex CLI / official Codex harness
    |      ├── OpenAI API
    |      ├── Gemini CLI
    |      ├── Gemini API
    |      └── Vertex AI
    |
    +--> Usage Metering
    +--> Cost Estimation
    +--> Health / Rate-limit state
    +--> Audit trail
```

The project must **not** assume that a consumer subscription is equivalent to API credits.

That distinction is provider-specific and is critical.

---

# 2. Important provider reality: subscription access is not the same as API access

Before implementation, separate these concepts clearly in code and UI.

## Claude

Anthropic currently allows Claude Pro and Max subscribers to use Claude Code with the same subscription.

However:

- Claude Pro/Max does **not** automatically include normal Claude Console API usage.
- Anthropic explicitly says third-party software should preferably authenticate through Claude Console API keys or supported cloud providers.
- Claude Code prioritizes `ANTHROPIC_API_KEY` over subscription authentication if the environment variable exists.

Therefore:

```text
Claude subscription
        !=
Anthropic API credits
```

If ApplyPack uses a Claude subscription, it should do so through the **official Claude Code execution path**, not by extracting a Claude OAuth token and pretending that it is a normal API key.

Do not copy Claude subscription tokens into the ApplyPack database.

---

## OpenAI

OpenAI currently treats:

```text
ChatGPT billing
```

and:

```text
OpenAI API billing
```

as separate systems.

A ChatGPT subscription does not make normal OpenAI API requests free.

ChatGPT plans can include access to **Codex**, and Codex clients can authenticate with the user's ChatGPT account.

Therefore the project should distinguish:

```text
OpenAI — ChatGPT / Codex connection
```

from:

```text
OpenAI — API connection
```

Do not take a ChatGPT login/session token and use it as a Responses API bearer token.

For normal OpenAI API calls use an OpenAI API credential.

For subscription-backed usage use an officially supported Codex client/harness path.

---

## Gemini

Gemini CLI officially supports:

- Google-account sign-in;
- Google AI Pro;
- Google AI Ultra;
- Gemini API keys;
- Vertex AI.

Google AI Pro/Ultra can provide higher Gemini CLI quotas.

The Gemini API has separate billing and API-key behavior.

Therefore:

```text
Google AI subscription via Gemini CLI
        !=
Gemini API billing
```

The UI should expose these as separate connection types.

---

# 3. Main recommendation: stop designing around environment variables

The current pattern is probably conceptually similar to:

```text
CLAUDE_...
AI_MODEL=...
AI_PROVIDER=...
```

This works for one developer and one provider.

It becomes fragile immediately when the application supports:

- three providers;
- multiple credentials;
- subscriptions plus API keys;
- fallback;
- per-task model selection;
- cost budgets;
- provider health;
- model changes;
- multiple users.

`.env` should remain an **application bootstrap mechanism**, not the product's AI settings database.

---

# 4. What should remain in `.env`

Keep infrastructure configuration there, for example:

```text
DATABASE_URL
APP_SECRET
REDIS_URL
QUEUE_CONNECTION
AI_SECRET_ENCRYPTION_KEY_REF
```

Depending on deployment architecture.

Do not make the UI edit `.env`.

Do not store dynamic user/provider settings in `.env`.

---

# 5. What should move out of `.env`

Move these to application-level configuration:

```text
enabled providers
provider priority
default provider
default model
task-specific model
fallback order
API connection metadata
routing mode
budget
monthly spend limit
parallel mode
provider health
provider status
last successful call
```

Secrets should live in a secret store, not as ordinary Postgres text fields.

---

# 6. Introduce the concept of an AI Connection

Do not create one row called:

```text
ai_settings
```

with:

```text
claude_key
openai_key
gemini_key
```

That architecture will become painful very quickly.

Instead create an extensible entity:

```text
AI Connection
```

Example:

```text
Connection 1
Provider: Anthropic
Transport: Claude Code CLI
Auth: Claude subscription
Label: Claude Max
Enabled: yes
Priority: 10

Connection 2
Provider: OpenAI
Transport: OpenAI API
Auth: API key
Label: ApplyPack OpenAI API
Enabled: yes
Priority: 30

Connection 3
Provider: Google
Transport: Gemini CLI
Auth: Google account
Label: Google AI Pro
Enabled: yes
Priority: 20
```

This allows multiple credentials from the same provider later.

---

# 7. Suggested data model

The exact schema should match the existing database conventions.

A conceptual model could be:

```text
ai_connections
────────────────────────────────────────
id
provider
transport
auth_type
label
enabled
status
priority
secret_ref
config_json
capabilities_json
last_checked_at
last_success_at
last_error_code
last_error_message
created_at
updated_at
```

Possible values:

```text
provider:
  anthropic
  openai
  google

transport:
  claude_code_cli
  anthropic_api
  codex_cli
  openai_api
  gemini_cli
  gemini_api
  vertex_ai

auth_type:
  subscription
  api_key
  oauth
  adc
  service_account
```

Do not use transport names as user-facing labels.

---

# 8. Keep secrets outside the ordinary connection row

Use:

```text
secret_ref
```

rather than:

```text
api_key TEXT
```

Conceptually:

```text
ai_connections
      |
      └── secret_ref
              |
              v
      Secret Store
```

For a local desktop/self-hosted installation:

```text
OS Keychain / Credential Manager
```

is a strong option.

For a server installation:

```text
KMS / Vault / encrypted secret store
```

is preferable.

If encrypted database storage is necessary:

- use envelope encryption;
- keep the master encryption key outside the database;
- support rotation;
- never expose decrypted secrets to frontend code.

---

# 9. Subscription credentials should usually remain owned by the official CLI

This is one of the most important implementation rules.

For:

```text
Claude Code
Codex
Gemini CLI
```

prefer:

```text
ApplyPack
    |
    v
official CLI / harness
    |
    v
provider-owned credential cache
```

instead of:

```text
ApplyPack
    |
    v
copy OAuth token from provider CLI
    |
    v
store token in Postgres
```

Do not make ApplyPack responsible for refreshing consumer-subscription OAuth tokens unless the provider explicitly exposes and supports that integration model.

---

# 10. Recommended provider adapters

Implement a thin common interface.

Example:

```ts
interface AiProviderAdapter {
  probe(): Promise<ConnectionHealth>;

  listModels(): Promise<ModelDescriptor[]>;

  invoke(request: AiRequest): Promise<AiResponse>;

  getCapabilities(): ProviderCapabilities;

  getUsageCapabilities(): UsageCapabilities;
}
```

The real interface should be adapted to the project's language/framework.

---

# 11. Initial adapters

Recommended first-class adapters:

```text
ClaudeCodeAdapter
AnthropicApiAdapter

CodexAdapter
OpenAiApiAdapter

GeminiCliAdapter
GeminiApiAdapter
VertexAiAdapter
```

Cloud providers such as Bedrock can be added later without changing the orchestrator.

---

# 12. Subscription transport vs API transport

These should implement the same high-level logical request interface but remain operationally distinct.

Example:

```text
AiRequest
    |
    +--> SubscriptionCliTransport
    |
    +--> HttpApiTransport
```

The caller should not need to know whether the request eventually goes to:

```text
claude -p
codex ...
gemini -p
/v1/responses
/v1/messages
Gemini generateContent
```

But the orchestrator **does** need to retain that information for:

- billing;
- retries;
- capabilities;
- quotas;
- observability.

---

# 13. Claude subscription support

## Recommended implementation

If the application currently depends on a Claude subscription, preserve that capability as:

```text
Anthropic
Connection type: Claude subscription
Transport: Claude Code
```

Do not label it:

```text
Claude API
```

because it is not the same billing/auth path.

---

# 14. Claude Code discovery

The local runner can detect:

```text
claude --version
```

Then verify whether the CLI appears authenticated.

Avoid performing a paid inference request merely to discover whether the executable exists.

If an actual inference is required for a connection test, make that explicit:

```text
Test connection
May consume provider quota.
```

---

# 15. Claude API support

Allow an independent API connection:

```text
Anthropic API
```

with its own API key.

Example UI:

```text
Claude

Claude Max
Subscription · Claude Code
Connected

Anthropic API
API key · Pay as you go
Connected
```

These can coexist.

---

# 16. Important Claude API-key precedence issue

Claude Code currently gives an environment API key precedence over subscription authentication.

This can create a very dangerous configuration.

Example:

```text
User thinks:
Claude Max subscription is being used

Reality:
ANTHROPIC_API_KEY is present
Claude Code bills API usage
```

The application must protect against this.

For a Claude subscription execution, invoke the child process with an **explicit sanitized environment**.

Do not inherit every environment variable blindly.

Conceptually:

```text
env = allowlistedSystemEnvironment()

remove ANTHROPIC_API_KEY

run Claude Code subscription transport
```

For the Anthropic API connection:

```text
use API adapter directly
```

Do not switch auth modes through global process environment state.

---

# 17. OpenAI subscription support

OpenAI should appear as two possible connection families.

```text
OpenAI

ChatGPT / Codex
Subscription connection

OpenAI API
Pay-as-you-go connection
```

The application must not imply that a ChatGPT subscription pays for ordinary API traffic.

---

# 18. Codex subscription transport

If using ChatGPT subscription capacity, integrate through the **official Codex path**.

Do not:

- scrape ChatGPT;
- automate browser cookies;
- copy web session credentials;
- treat ChatGPT authentication as an API key.

The exact harness integration should be chosen based on the current official Codex SDK/app-server/CLI capabilities available in the repository environment.

The agent implementing this feature must verify current OpenAI Codex documentation before choosing the transport.

---

# 19. OpenAI API transport

For application-level structured tasks, an OpenAI API adapter is often the cleanest integration.

Benefits:

- predictable HTTP interface;
- structured output;
- token usage;
- project-specific API credentials;
- clearer billing;
- easier retries;
- easier background jobs;
- no dependency on an interactive local login.

This should remain separate from the ChatGPT/Codex connection.

---

# 20. Gemini subscription support

Gemini CLI is particularly suitable for a local subscription adapter because it officially supports:

```text
Sign in with Google
Google AI Pro
Google AI Ultra
```

and also provides a documented headless mode.

A subscription connection can therefore be represented as:

```text
Google
Google AI Pro
Gemini CLI
Connected
```

---

# 21. Gemini headless mode

Gemini CLI supports programmatic headless execution.

It can return JSON containing:

- response;
- usage statistics;
- latency;
- errors.

That is useful for the ApplyPack adapter.

Use structured output rather than parsing human CLI text whenever possible.

---

# 22. Gemini API support

Also provide:

```text
Gemini API key
```

as an independent connection.

The user can choose between:

```text
Google AI Pro subscription
```

and:

```text
Gemini API pay-as-you-go
```

without modifying `.env`.

---

# 23. Vertex AI

Vertex AI should be treated as a Google provider connection with separate auth:

```text
ADC
service account
Google Cloud API key
```

It is valuable for:

- organizations;
- IAM;
- centralized billing;
- service-account deployments;
- cloud-hosted installations.

It does not need to be Phase 1 if the project is personal/local.

Design the schema so it can be added without migration pain.

---

# 24. Multiple subscriptions simultaneously

Yes, the architecture should support several **enabled connections** at the same time.

Example:

```text
✓ Claude Max
✓ ChatGPT / Codex
✓ Google AI Pro
✓ OpenAI API
✓ Gemini API
```

However, "enabled" should not mean:

> send every request to everything.

It means:

> this connection is available to the router.

---

# 25. Do not create one global provider selector only

Avoid:

```text
AI Provider:
[ Claude ▼ ]
```

as the entire architecture.

Different tasks have different requirements.

Example:

```text
Job classification
Resume scan
Resume match
Resume rewrite
Job summary
Company discovery
Daily digest
```

A provider/model that is good for one task may be expensive or unnecessary for another.

---

# 26. Introduce AI Task Types

Create stable application-level task identifiers.

Example:

```text
job_classify
resume_scan
resume_match
resume_suggestions
job_summary
company_enrichment
digest_generate
```

Do not route based on random prompt strings.

---

# 27. Per-task routing

A task can have its own routing policy.

Example:

```text
Resume match
Primary: Claude Max
Fallback: Gemini Pro → OpenAI API

Job classification
Primary: Gemini API fast model
Fallback: OpenAI API fast model

Resume suggestions
Primary: OpenAI GPT
Fallback: Claude Max
```

This is substantially more useful than one application-wide provider.

---

# 28. Recommended routing modes

Implement a small explicit set.

```text
Single
Fallback
Subscription-first
Cost-aware
Compare
```

Do not start with a complex generic rules language.

---

# 29. Single mode

```text
Mode: Single
Connection: Claude Max
Model: Auto
```

Every eligible task goes to that connection.

Good default for users who want predictable behavior.

---

# 30. Ordered fallback mode

Example:

```text
1. Claude Max
2. Google AI Pro
3. ChatGPT / Codex
4. OpenAI API
```

The router tries the next connection only for defined retry/fallback conditions.

This is probably the most useful multi-subscription mode.

---

# 31. Subscription-first mode

This mode matches the user's stated goal well.

Example:

```text
Subscription-first

1. Claude Max
2. Google AI Pro
3. ChatGPT / Codex

Paid API fallback
4. OpenAI API
5. Gemini API
```

The system attempts fixed-subscription capacity first and only uses metered API capacity when necessary.

The UI must make this behavior explicit.

Example:

```text
Prefer subscription usage.
Use paid API only if subscription providers are unavailable or over limit.
```

---

# 32. Paid API fallback must require explicit permission

Do not silently go from:

```text
subscription
```

to:

```text
billable API
```

unless the user has enabled that behavior.

Recommended setting:

```text
When subscriptions are unavailable

○ Stop and report the error
● Use configured API fallback
```

Optional:

```text
Maximum API fallback spend per day: $2.00
```

---

# 33. Cost-aware routing

For API connections, the router can consider:

- model pricing;
- expected input size;
- expected output size;
- task quality tier;
- budget.

Do not over-engineer this in Phase 1.

A useful first version:

```text
Quality:
  Fast / cheap
  Balanced
  Best available
```

mapped to configured models.

---

# 34. Compare / parallel mode

The user asked about using several providers simultaneously.

This should exist, but it should be an explicit advanced mode.

Example:

```text
Compare with
[x] Claude
[x] OpenAI
[x] Gemini
```

The same logical input is sent to selected providers in parallel.

---

# 35. Do not run all providers for every normal request

Parallel execution has costs:

- additional latency;
- additional subscription quota;
- additional API cost;
- more complicated error handling;
- inconsistent answers;
- more storage;
- more complex result reconciliation.

Use it for:

- benchmarking;
- high-value resume analysis;
- quality comparison;
- disagreement detection;
- debugging prompts.

Do not use it globally by default.

---

# 36. Parallel results should remain distinct

For something subjective like resume score:

```text
Claude: 92
OpenAI: 96
Gemini: 88
```

Do **not** automatically calculate:

```text
Average: 92
```

unless the scoring methodology is explicitly calibrated.

Each model may interpret the rubric differently.

Better:

```text
Consensus
2 of 3 providers identified troubleshooting as the main gap.
```

---

# 37. Structured classification consensus

For deterministic categories, a consensus strategy can be useful.

Example:

```text
Claude: fit
OpenAI: fit
Gemini: no-fit
```

Result:

```text
fit
Confidence: 2/3 providers
```

But only use this where labels have an exact shared schema.

---

# 38. Side-effecting tasks must not execute in parallel

Never allow multiple providers to independently perform real side effects such as:

- sending notifications;
- updating the same database record;
- applying resume edits;
- changing application status.

Parallel providers may produce candidates.

One orchestrator commits the final action.

Conceptually:

```text
Claude ───┐
OpenAI ───┼──> Compare / choose ───> one canonical write
Gemini ───┘
```

---

# 39. Define fallback conditions precisely

Fallback should occur for operational failure:

```text
authentication unavailable
quota exhausted
429
timeout
provider 5xx
temporary network failure
model unavailable
```

Do not automatically fallback merely because:

```text
the model returned an answer the user dislikes
```

That would make behavior unpredictable.

---

# 40. Provider refusal

Treat a model refusal separately from infrastructure failure.

Do not silently bypass a safety refusal by sending the same request through every provider.

Record:

```text
status: refused
```

and surface it appropriately.

---

# 41. Rate-limit aware routing

Track connection-level operational state.

Example:

```text
Claude Max
Available

Google AI Pro
Cooling down until 1:48 PM

OpenAI API
Available

Gemini API
Rate limited
Retry after 22s
```

The router should understand:

```text
healthy
degraded
cooldown
quota_exhausted
auth_error
disabled
```

---

# 42. Circuit breaker

If a provider repeatedly fails:

```text
5 failures in 2 minutes
```

stop sending new traffic briefly.

Example:

```text
OpenAI API
Temporarily unavailable
Retrying after 60 seconds
```

Do not repeatedly create expensive failing attempts.

---

# 43. Avoid retry storms across providers

A logical request can produce many physical attempts.

Example:

```text
logical request
   |
   +--> Claude retry 1
   +--> Claude retry 2
   +--> Gemini
   +--> Gemini retry
   +--> OpenAI
```

Without controls, one user action can become five or ten model calls.

Set:

```text
max_attempts
max_provider_switches
overall_deadline
```

per task type.

---

# 44. Model abstraction

Do not hard-code only one current model name.

Models change frequently.

Use a descriptor:

```text
ModelDescriptor
────────────────────────────
provider_model_id
display_name
capabilities
context_window
structured_output
tool_support
vision_support
reasoning_levels
availability
```

---

# 45. Model discovery

Where a provider exposes an official model-listing capability:

- discover models automatically;
- cache the result;
- refresh periodically;
- let the user refresh manually.

Where official dynamic discovery is unavailable:

- maintain a provider adapter manifest;
- update the application normally.

Do not scrape consumer web UIs for model names.

---

# 46. Auto model vs pinned model

Offer:

```text
Model
● Auto / recommended
○ Specific model
```

`Auto` should resolve to an internal model policy.

This avoids breaking user configuration every time providers rename models.

For high-value workflows, allow model pinning.

---

# 47. Capability routing

A request should declare what it needs.

Example:

```text
AiRequestCapabilities
────────────────────────
structured_output: true
vision: false
long_context: true
tools: false
reasoning: high
```

The router should exclude connections/models that cannot satisfy the request.

---

# 48. Provider-specific prompts

Do not assume one prompt performs identically on all providers.

Use:

```text
shared task schema
+
shared behavioral requirements
+
optional provider-specific prompt adaptation
```

Example:

```text
PromptTemplate
├── common
├── anthropic_override
├── openai_override
└── google_override
```

Keep differences small and tested.

---

# 49. Structured output is essential for this project

ApplyPack uses AI for data processing, not only free-form chat.

Responses should be validated against explicit schemas.

Example:

```json
{
  "fit_score": 91,
  "summary": "...",
  "requirements": [],
  "keywords": [],
  "recommendations": []
}
```

Each adapter should map the provider's structured-output mechanism to the same application schema.

---

# 50. Validation layer

Never write model JSON directly to core tables.

Use:

```text
provider response
      |
      v
parse
      |
      v
schema validation
      |
      +--> valid -> canonical result
      |
      └--> invalid -> repair/retry/fail
```

This becomes even more important with multiple providers.

---

# 51. Canonical internal response

Normalize provider responses.

Conceptual type:

```text
AiResponse
────────────────────────
text
structured_data
provider
connection_id
model
finish_reason
input_tokens
output_tokens
cached_tokens
latency_ms
provider_request_id
usage_raw
```

Not every field is available for every provider.

Use nullable fields rather than fabricated values.

---

# 52. AI request observability

Separate a logical task from provider attempts.

Recommended:

```text
ai_runs
```

for one application-level operation.

Example:

```text
Resume match for job 1043
```

Then:

```text
ai_attempts
```

for actual provider calls.

---

# 53. Suggested `ai_runs`

```text
ai_runs
────────────────────────────────
id
task_type
subject_type
subject_id
routing_policy_id
status
started_at
completed_at
selected_attempt_id
triggered_by
metadata_json
```

---

# 54. Suggested `ai_attempts`

```text
ai_attempts
────────────────────────────────
id
ai_run_id
connection_id
provider
transport
model
attempt_number
started_at
completed_at
latency_ms
status
error_type
error_code
fallback_reason
input_tokens
cached_input_tokens
output_tokens
estimated_cost_usd
actual_cost_usd
provider_request_id
pricing_snapshot_id
usage_json
```

Never store provider secrets here.

---

# 55. Why this model matters

It lets you answer:

```text
Which provider handled this resume?
Why did fallback happen?
How many attempts were made?
How much API money was spent?
Which model is slowest?
Which model produces invalid JSON most often?
How often does Claude hit quota?
How much work uses subscriptions vs API?
```

This is extremely valuable later.

---

# 56. API cost tracking

The user specifically wants to know how much the project costs when API keys are used.

Implement **local per-request metering** first.

For each successful request:

1. read provider-reported usage;
2. record input/output/cached tokens where available;
3. match the model to a versioned pricing snapshot;
4. calculate estimated cost;
5. store both raw usage and estimated cost.

---

# 57. Do not use one permanent pricing table

Provider prices change.

Create:

```text
ai_pricing_snapshots
```

Example:

```text
provider
model
effective_from
input_price
cached_input_price
output_price
other_unit_prices_json
currency
source_version
```

Each request stores the price snapshot used for its estimate.

Historical reports then remain reproducible.

---

# 58. Estimated vs actual cost

Use two concepts:

```text
Estimated local cost
```

and:

```text
Provider-reported / reconciled cost
```

Do not pretend they are identical.

Provider billing may include:

- special tools;
- batch discounts;
- caching;
- regional multipliers;
- pricing changes;
- credits;
- minimum billing units.

---

# 59. OpenAI usage reconciliation

OpenAI currently exposes organization usage/cost APIs for appropriate admin credentials.

Do not require an organization admin key merely to use ApplyPack.

A normal project API connection should work without billing-admin permissions.

Offer optional advanced integration:

```text
Connect billing read access
```

if the user wants authoritative reconciliation.

Otherwise:

```text
Local estimated spend
```

is enough.

---

# 60. Anthropic cost reconciliation

Anthropic Console provides API usage/cost reporting.

Enterprise also has analytics/admin capabilities for eligible organizations.

Again:

- do not require elevated admin credentials by default;
- local request accounting should work independently.

---

# 61. Gemini cost reconciliation

Gemini API usage can be monitored through AI Studio and Google Cloud billing.

Billing data may be delayed.

ApplyPack should still maintain real-time local estimates from request usage.

Optional reconciliation can happen later.

---

# 62. Subscription usage is not API spend

This requires careful UI design.

For subscription connections do not show:

```text
Cost: $0.00
```

for every request.

That is misleading.

Instead show:

```text
Billing: Subscription
Requests: 143
Tokens observed: ...
Provider quota: ...
```

where data is available.

---

# 63. Subscription monthly cost

If the user wants total project economics, allow an optional configured fixed cost:

```text
Claude Max
Monthly subscription allocation: $...
```

But label it:

```text
Configured monthly subscription cost
```

not:

```text
Model usage cost
```

Provider subscription price may vary by:

- country;
- tax;
- billing cycle;
- annual plan;
- tier;
- discounts.

Do not hard-code a global value as authoritative.

---

# 64. Optional allocated project cost

For personal analysis, ApplyPack could display:

```text
Subscriptions
Claude Max      $X/month
ChatGPT         $Y/month
Google AI Pro   $Z/month

API usage this month
OpenAI          $4.81
Anthropic       $0
Gemini          $1.22

Configured fixed subscriptions   $...
Metered API spend                $6.03
```

This is much more honest than trying to invent per-request subscription cost.

---

# 65. Optional "API-equivalent value"

A useful advanced metric:

```text
Estimated equivalent API cost
```

for subscription-backed runs.

Example:

```text
Claude subscription usage
Observed tokens: ...
Estimated API-equivalent value: $18.40
```

This can help the user understand subscription value.

But mark it very clearly:

```text
Estimate only — not an Anthropic charge
```

This metric is optional and should not appear by default.

---

# 66. Budgets

Add user-defined API budgets.

Example:

```text
API spend limits

Daily soft alert       $2
Daily hard limit       $5
Monthly soft alert     $25
Monthly hard limit     $40
```

Separate provider quotas from money budgets.

---

# 67. Budget enforcement

Before a billable API request:

```text
estimated request cost
+
period spend
```

can be checked against the user's hard limit.

For requests whose cost cannot be estimated accurately in advance, use conservative bounds.

Do not claim a hard cap is mathematically exact if provider usage can exceed it before billing data arrives.

---

# 68. API connection isolation per project

Best practice:

Create provider credentials specifically for ApplyPack where possible.

Examples:

```text
OpenAI project: ApplyPack
Anthropic workspace/key: ApplyPack
Google project: ApplyPack
```

Benefits:

- cleaner billing;
- easier key rotation;
- narrower blast radius;
- easier revocation;
- provider-side usage filtering.

Do not reuse a personal all-purpose production key if avoidable.

---

# 69. Settings IA

Add:

```text
Settings
├── General
├── AI Providers
├── Notifications
└── Advanced
```

AI configuration deserves its own Settings page.

Do not hide it inside `.env` documentation.

---

# 70. Recommended AI Providers page

```text
AI Providers

Connect one or more AI services.
ApplyPack can use a single provider, fall back in order,
or compare providers for selected tasks.


Connections
────────────────────────────────────────────────────────

Claude Max
Anthropic · Subscription via Claude Code
Connected · Last used 8 min ago
Default for Resume Match
[Manage]


Google AI Pro
Google · Subscription via Gemini CLI
Connected · Last used 1h ago
Fallback #1
[Manage]


ChatGPT / Codex
OpenAI · Subscription via Codex
Connected
Fallback #2
[Manage]


OpenAI API
OpenAI · API key · Pay as you go
Connected · $4.81 this month
Fallback #3
[Manage]


[+ Connect AI provider]
```

---

# 71. Connect-provider flow

Step 1:

```text
Connect AI provider

[Anthropic]
[OpenAI]
[Google]
```

Step 2 should show supported auth methods.

Example Anthropic:

```text
How do you want to connect?

Claude subscription
Uses your local Claude Code login.
No API key required.

Anthropic API
Uses a Claude Console API key.
Pay-as-you-go usage.
```

---

# 72. OpenAI connection UI

```text
OpenAI

ChatGPT / Codex
Use an existing ChatGPT account through the supported
Codex authentication flow.

[Connect]

OpenAI API
Use a project API key for metered API requests.

[Add API key]
```

Add a small clarification:

```text
ChatGPT subscription and API billing are separate.
```

This avoids a major source of billing confusion.

---

# 73. Google connection UI

```text
Google

Google AI subscription
Use Gemini CLI with your signed-in Google account.
Supports eligible Google AI Pro / Ultra usage.

[Connect]

Gemini API
Use an AI Studio API key.

[Add API key]

Vertex AI
Use Google Cloud credentials.

[Configure]
```

---

# 74. Automatic local CLI detection

When opening AI Providers, the local AI runner can detect:

```text
Claude Code installed
Codex installed
Gemini CLI installed
```

Example:

```text
Claude Code      Installed · authenticated
Codex            Installed · authentication required
Gemini CLI       Installed · authenticated
```

Do not auto-trigger sign-in.

Use:

```text
Connect
```

to let the user authorize.

---

# 75. Do not infer subscription plan unless reliably available

If the CLI/provider does not expose plan information safely, display:

```text
Claude account
Subscription authentication
```

rather than guessing:

```text
Claude Max 20x
```

Only display a plan name if the provider explicitly returns it.

---

# 76. Connection test

Every connection should support:

```text
Test connection
```

The result should distinguish:

```text
Connected
Authentication expired
CLI not installed
API key invalid
Quota reached
Permission denied
Model unavailable
```

Avoid:

```text
Something went wrong
```

---

# 77. Provider connection details

Example:

```text
OpenAI API

Status          Connected
Authentication  API key
Key             sk-proj-••••8F2A
Last checked    2 min ago
Last used       8 min ago
This month      $4.81 estimated

Default model   Auto
Enabled         On

[Test]
[Replace key]
[Disable]
[Remove]
```

Never render the full key after it is stored.

---

# 78. Subscription connection details

Example:

```text
Google AI

Status          Connected
Authentication  Google account via Gemini CLI
Plan            Google AI Pro   // only if reliably detected
Last checked    3 min ago
Usage mode      Subscription

Model           Auto
Enabled         On

[Test]
[Re-authenticate]
[Disable]
```

Do not display OAuth access/refresh tokens.

---

# 79. Routing page/section

Recommended:

```text
AI Routing

Default mode
● Subscription first
○ Single provider
○ Ordered fallback
○ Cost aware


Priority
────────────────────────────
1  Claude subscription
2  Google AI subscription
3  ChatGPT / Codex
4  OpenAI API

[Reorder]
```

---

# 80. Task overrides

Add an Advanced section:

```text
Task routing

Resume scanning
Claude subscription
Fallback: Gemini

Resume matching
OpenAI
Fallback: Claude → Gemini

Job classification
Gemini
Fallback: OpenAI

Daily digest
Auto
```

Do not force casual users to configure this.

A good default should work automatically.

---

# 81. Compare mode UI

This should be task-specific.

Example on Resume Match:

```text
Analyze with
[Auto ▼]
```

Options:

```text
Auto
Claude
OpenAI
Gemini
Compare 2 providers...
```

If Compare is selected:

```text
Compare analysis

[x] Claude
[x] OpenAI
[ ] Gemini

This will use quota from each selected provider.

[Run comparison]
```

---

# 82. Do not make provider choice dominate normal screens

Normal users should mostly see:

```text
Auto
```

Provider management belongs in Settings.

On result/history pages, record:

```text
Analyzed with Claude
```

as secondary metadata.

---

# 83. Automatic routing principles

"Automatic" should mean:

- detect available connections;
- detect connection health;
- detect quota/rate-limit failures;
- select an eligible model;
- use fallback if allowed;
- track usage;
- enforce user budget;
- log why a route was chosen.

It should **not** mean:

- automatically connect provider accounts;
- automatically spend API money;
- silently change billing mode;
- extract credentials from another app;
- enable a newly detected provider without consent.

---

# 84. Routing decision audit

For each run record:

```text
Routing decision

Task: resume_match
Policy: subscription_first
Selected: Claude Code
Reason: priority 1, healthy, capability match

Fallback:
Gemini CLI
OpenAI API
```

If fallback occurs:

```text
Claude Code
quota_exhausted

→ Gemini CLI
success
```

This is very useful for debugging.

---

# 85. Local app vs hosted SaaS is a critical architecture boundary

Subscription CLI authentication is naturally local.

If ApplyPack remains local:

```text
browser
backend
local runner
provider CLIs
```

is practical.

If ApplyPack becomes a hosted SaaS:

```text
server
cannot automatically access
user's local Claude/Codex/Gemini login
```

without a local agent.

Design for this distinction now.

---

# 86. Recommended Local AI Runner

Because ApplyPack appears to run locally and may use containers, a small host-side runner is a strong design.

Architecture:

```text
Browser
   |
   v
ApplyPack backend / Docker
   |
   v
Local AI Runner
   |
   +--> Claude Code
   +--> Codex
   +--> Gemini CLI
```

The runner executes under the user's operating-system account.

Benefits:

- subscription credentials remain in provider CLI stores;
- no need to copy OAuth files into Docker;
- CLI detection is easy;
- provider processes can be isolated;
- future desktop packaging is easier.

---

# 87. Docker warning

Do not solve subscription CLI auth by blindly mounting:

```text
~/.claude
~/.codex
~/.gemini
```

into multiple containers with broad read/write access.

That expands the credential attack surface.

Prefer a narrow local runner interface.

If mounting credentials is unavoidable:

- use least privilege;
- use read-only mounts where possible;
- isolate each provider;
- document the risk;
- never commit these directories.

---

# 88. Local runner API

The runner can expose a narrow local interface:

```text
POST /invoke
GET /providers
GET /providers/:id/health
GET /providers/:id/models
```

Bind only to:

```text
localhost
```

or use a Unix-domain socket.

Authenticate requests from the ApplyPack backend.

Do not expose it to the LAN by default.

---

# 89. Local runner security

Require:

- random local auth token;
- origin/process controls where possible;
- request size limits;
- command allowlist;
- timeouts;
- sanitized environment;
- no arbitrary shell command from the frontend;
- no arbitrary executable path supplied by user input.

---

# 90. Never build CLI commands by concatenating strings

Bad:

```text
"claude -p " + user_prompt
```

Good:

```text
spawn(executable, ["-p", prompt], ...)
```

Use process APIs with argument arrays.

This prevents command injection.

---

# 91. Child process environment isolation

For every CLI adapter define an explicit environment allowlist.

Do not inherit:

```text
all application secrets
database password
Telegram token
other AI provider keys
```

into provider child processes.

A Claude child process does not need the OpenAI key.

A Gemini process does not need the Telegram bot token.

---

# 92. Timeout and cancellation

Every provider call must support:

```text
deadline
cancellation
```

If the user cancels:

- cancel the child process / HTTP request where possible;
- mark attempt cancelled;
- do not automatically fallback unless policy says so.

---

# 93. Concurrency limits

Define per connection:

```text
max_concurrency
```

and potentially:

```text
queue_limit
```

Subscription CLIs may behave poorly if many simultaneous processes share one local credential/session.

Begin conservatively.

---

# 94. Job queue integration

AI work should go through the existing background-job mechanism if available.

Conceptually:

```text
app task
   |
   v
queue
   |
   v
AI orchestrator
   |
   v
provider
```

This is particularly important for:

- resume scanning;
- reclassification;
- bulk jobs;
- compare mode.

---

# 95. Idempotency

Every logical AI task should have an idempotency/fingerprint concept.

This prevents duplicate paid calls when:

- browser retries;
- worker restarts;
- network response is lost;
- user double-clicks.

Do not cache across semantically different task states.

---

# 96. Provider-specific quota semantics

Do not reduce every provider to:

```text
requests remaining
```

Different providers expose different constraints.

Internally support:

```text
rate_limit
usage_limit
daily_requests
token_limit
credit_balance
unknown
```

The UI can normalize only what is meaningful.

---

# 97. Unknown quota is a valid state

For subscription providers, exact remaining usage may not always be exposed.

Display:

```text
Usage limit
Managed by provider
```

rather than inventing a percentage.

---

# 98. Cost dashboard

Consider a dedicated:

```text
AI Usage
```

page or Settings subpage.

Suggested overview:

```text
AI usage · August

API spend
$6.03 estimated

Subscription-backed runs
312

API-backed runs
47

Total AI runs
359
```

---

# 99. Usage by provider

```text
Claude
Subscription
184 runs
No metered API spend

OpenAI
ChatGPT / Codex
76 runs

OpenAI API
$4.81
31 runs

Gemini
Google AI Pro
52 runs

Gemini API
$1.22
16 runs
```

Do not combine fixed subscriptions and pay-as-you-go into one deceptive "AI cost" number unless the user has configured fixed subscription cost allocation.

---

# 100. Usage by task

This is likely even more useful:

```text
Resume Match          $3.12
Resume Scan           $1.88
Job Classification    $0.71
Digest                 $0.32
```

This tells the user which workflow is expensive.

---

# 101. Usage by model

```text
Model                  Runs     Input     Output     Est. API cost
...
```

Only expose token/cost values the provider actually returns or that can be reliably estimated.

---

# 102. Usage metadata and privacy

ApplyPack handles resumes and job descriptions.

These can contain:

- names;
- email;
- phone;
- location;
- employment history.

Do not store raw prompts/responses in observability tables automatically just because provider logging is useful.

Recommended:

```text
metadata by default
raw payload logging: off
```

Allow explicit debug logging with a warning.

---

# 103. Redaction

Application logs must never contain:

- API keys;
- OAuth tokens;
- auth headers;
- full secret-bearing CLI environment;
- resume PII unless specifically required.

Use structured redaction middleware.

---

# 104. API key permissions

Where providers support narrower project/service credentials:

- use project-specific key;
- use minimal scopes;
- avoid organization-admin keys;
- avoid billing-admin keys for normal inference.

Billing reconciliation credentials should be optional and separate.

---

# 105. Credential rotation

Every API connection should support:

```text
Replace key
```

without deleting historical usage.

Historical `ai_attempts` point to the logical connection id, not secret value.

---

# 106. Removing a connection

Removing a provider connection should:

- remove/revoke local secret reference;
- disable future routing;
- retain historical usage records;
- not delete completed AI results.

Use:

```text
Remove connection?
Historical analysis and usage records will remain.
```

---

# 107. Legacy `.env` migration

Do not break the current project immediately.

Add a migration layer.

Example startup behavior:

```text
Legacy Claude configuration detected.

[Import into AI Providers]
```

After import:

```text
Claude
Imported from environment
```

The agent should inspect exactly how current Claude auth works before migrating.

---

# 108. Environment-backed connection

As a transitional feature, support:

```text
Credential source: environment
```

This allows old deployments to keep working.

But UI should say:

```text
Managed by environment
```

and disable editing of the actual secret.

Example:

```text
Anthropic API
Managed by environment
Key ending ••••A93F

[Disable]
```

Do not pretend the UI can delete a value that lives in `.env`.

---

# 109. Precedence rules

Avoid hidden precedence.

Bad:

```text
.env happens to override database
```

Better:

```text
connection explicitly references:
  secret_source = environment
```

Every AI attempt knows exactly which connection was selected.

---

# 110. Suggested routing schema

Conceptually:

```text
ai_routing_policies
────────────────────────────
id
name
mode
allow_paid_fallback
daily_paid_limit
monthly_paid_limit
config_json
```

Then:

```text
ai_routing_steps
────────────────────────────
policy_id
position
connection_id
model_policy
fallback_on_json
```

---

# 111. Task-policy mapping

```text
ai_task_routes
────────────────────────────
task_type
routing_policy_id
model_quality
timeout_ms
max_attempts
```

Keep the first implementation small.

---

# 112. Recommended default policy for ApplyPack

For a local personal deployment with several paid subscriptions:

```text
Subscription First

1. Claude subscription
2. Google AI subscription
3. ChatGPT / Codex
4. API fallback only if explicitly enabled
```

But do **not** automatically apply the same chain to every task.

---

# 113. Recommended task strategy

### Resume match / resume suggestions

Quality is important.

Recommended:

```text
high-quality provider
fallback to another subscription
optional API fallback
```

### Job classification

Volume may be high.

Prefer:

```text
fast / lower-cost model
```

or a two-stage system.

Do not consume premium subscription quota on thousands of obvious rejects unless that is intentional.

### Bulk reclassification

Require:

```text
estimated request count
selected routing policy
whether paid API fallback is allowed
```

before starting.

---

# 114. Bulk-operation protection

Example:

```text
Re-classify 2,481 jobs

Routing
Subscription first

Paid API fallback
Enabled up to $5.00

Estimated maximum API calls
...

[Start]
```

This avoids accidental bills.

---

# 115. Provider comparison should be a separate feature

Do not confuse:

```text
Fallback
```

with:

```text
Compare
```

Fallback:

> use another provider only when the previous provider could not complete the request.

Compare:

> deliberately ask multiple providers for the same logical task.

They require different metrics and UI.

---

# 116. Evaluation framework

Once multiple providers exist, add offline evals.

Create a small test corpus:

```text
20–50 representative jobs
several resumes
known expected classifications
known evidence constraints
```

Compare:

```text
accuracy
schema validity
latency
cost
false positives
unsupported claims
```

Do not decide provider priority only by anecdotal impressions.

---

# 117. Provider quality score should be task-specific

Avoid:

```text
Claude = best
OpenAI = 2nd
Gemini = 3rd
```

Globally.

Instead evaluate:

```text
resume_match
job_classify
summary
rewrite
```

independently.

---

# 118. Shadow testing

A useful later feature:

```text
Primary result goes to user.
Secondary provider runs only on sampled requests.
```

Example:

```text
5% shadow compare
```

Use it to measure quality without changing production behavior.

Only enable with explicit quota/cost settings.

---

# 119. Prompt/version tracking

Every run should record:

```text
prompt_version
schema_version
routing_policy_version
```

This is essential when comparing providers.

Otherwise score differences could be caused by prompt changes rather than model quality.

---

# 120. Reproducibility

Record:

```text
provider
model id
task version
prompt version
schema version
temperature/reasoning settings
timestamp
```

where supported.

Do not assume provider aliases are immutable.

---

# 121. Error taxonomy

Normalize provider errors:

```text
auth_error
quota_exhausted
rate_limited
timeout
provider_unavailable
invalid_request
model_unavailable
invalid_output
refused
cancelled
unknown
```

Provider adapters translate raw errors to these categories.

---

# 122. User-visible fallback message

Do not expose internal stack traces.

Example:

```text
Claude reached its current usage limit.
The analysis continued with Gemini.
```

Optional details:

```text
View run details
```

---

# 123. User-visible paid fallback message

If a billable API was used after subscriptions failed:

```text
Completed with OpenAI API

Claude and Gemini subscription connections were unavailable.
Estimated API cost: $0.08.
```

This builds trust.

---

# 124. Automatic provider status

Settings can show:

```text
Claude          Ready
Gemini          Ready
OpenAI API      Ready
Codex           Sign-in required
```

Status checks should be cached.

Do not run expensive health probes every page load.

---

# 125. Health-check cadence

Suggested behavior:

- executable presence: on startup / manual refresh;
- auth state: startup + periodic;
- API connectivity: passive from real requests + manual test;
- provider outages: inferred from failures.

Avoid continuous token-consuming probes.

---

# 126. Notifications for provider problems

Optional:

```text
Claude subscription unavailable.
Fallback is currently using OpenAI API.
```

This is especially useful if paid fallback is active.

---

# 127. Security threat: malicious prompt -> provider CLI

Because resumes/job descriptions are untrusted text, a model/agent CLI must not automatically gain broad shell or filesystem permissions merely because it is being used as an LLM transport.

If the task only needs text inference:

- disable tools where possible;
- restrict file access;
- use a temporary working directory;
- never run with unrestricted agent permissions.

This is very important.

---

# 128. Subscription CLI should not imply coding-agent permissions

For resume analysis, the AI does not need:

```text
shell
git
filesystem edits
network tools
```

Even if Claude Code/Codex/Gemini CLI can use them.

Run the most restricted configuration possible.

---

# 129. Temporary workspaces

If a CLI requires a working directory:

- create an isolated temporary directory;
- do not point it at the full ApplyPack repository;
- pass only the required content;
- delete temporary data after completion according to retention policy.

---

# 130. Privacy mode

Consider:

```text
AI data handling
```

settings.

Possible:

```text
Do not log prompt bodies
Do not store raw model responses after parsing
Keep AI run metadata for 30/90 days
```

This is especially relevant when resumes contain PII.

---

# 131. Do not make one universal "AI subscription" abstraction

Internally keep provider semantics.

Bad:

```text
SubscriptionToken
```

Good:

```text
ClaudeCodeSubscriptionConnection
CodexSubscriptionConnection
GeminiCliGoogleConnection
```

behind a common interface.

Provider authentication rules differ too much to pretend they are identical.

---

# 132. What can be unified safely

Unify:

```text
task request
response
structured validation
routing
health state
usage event
cost estimate
audit
settings UX
```

Do not over-unify:

```text
authentication internals
quota semantics
model identifiers
billing semantics
provider-specific capabilities
```

---

# 133. Third-party abstraction libraries

A library such as a multi-provider LLM gateway can be useful for **API calls**.

However it will not solve the most important part here:

```text
subscription-backed official CLI authentication
```

Therefore do not redesign the whole project around a library solely because it supports multiple API providers.

A good architecture is:

```text
ApplyPack's own provider interface
     |
     +--> optional common API library
     +--> official CLI adapters
```

This keeps the application independent.

---

# 134. Phase 1 implementation recommendation

Build the foundation before fancy routing.

### Phase 1A — connection registry

Implement:

```text
ai_connections
secret storage
provider status
Settings > AI Providers
```

### Phase 1B — API adapters

Add:

```text
Anthropic API
OpenAI API
Gemini API
```

with:

- connection test;
- models;
- token usage;
- cost estimate.

### Phase 1C — subscription adapters

Add local transports for:

```text
Claude Code
Codex
Gemini CLI
```

using provider-supported authentication mechanisms.

Do not extract OAuth credentials.

---

# 135. Phase 2

Implement:

```text
Single
Ordered fallback
Subscription-first
```

plus per-task routing.

This provides most of the value.

---

# 136. Phase 3

Implement:

```text
AI Usage dashboard
cost budgets
provider health
API usage reconciliation
```

---

# 137. Phase 4

Implement:

```text
Compare / parallel mode
eval suite
shadow testing
quality-based routing
```

Do not start here.

---

# 138. Recommended initial UX

Keep normal user setup simple.

```text
AI Providers

Claude
[Connect subscription] [Use API key]

OpenAI
[Connect ChatGPT/Codex] [Use API key]

Google
[Connect Google AI] [Use API key]
```

Once connected:

```text
Routing
Subscription first

Claude
↓
Gemini
↓
OpenAI
↓
Paid API fallback
```

Advanced configuration is hidden by default.

---

# 139. Example full UI

```text
Settings / AI Providers

AI providers
Connect the AI services you want ApplyPack to use.


Connections
────────────────────────────────────────────────────────

Claude
Subscription via Claude Code
● Connected
Last used 8 min ago
[Manage]

Google AI
Subscription via Gemini CLI
● Connected
Last used 1h ago
[Manage]

OpenAI
ChatGPT via Codex
● Connected
[Manage]

OpenAI API
API key · Pay as you go
● Connected
$4.81 estimated this month
[Manage]

[+ Add connection]


Routing
────────────────────────────────────────────────────────

Default
[Subscription first ▼]

1  Claude subscription
2  Google AI subscription
3  ChatGPT / Codex

Paid API fallback                        [on]
Maximum API fallback spend / day         [$ 2.00]

[Advanced task routing]


Usage this month
────────────────────────────────────────────────────────

Subscription-backed runs       312
API-backed runs                  47
Estimated API spend           $6.03

[View AI usage]
```

---

# 140. API-key add flow

```text
Add OpenAI API connection

Name
[ApplyPack OpenAI]

API key
[••••••••••••••••••••••]

The key is encrypted and never shown again.

[Test connection]

Project / organization
[detected if safely available]

Default model
[Auto ▼]

[Cancel] [Save connection]
```

The UI must not claim secrets are encrypted unless implementation actually guarantees it.

---

# 141. Subscription add flow

```text
Connect Google AI

Gemini CLI
Installed

Sign in with your Google account to use eligible
Gemini CLI subscription quota.

[Sign in]

Your credentials stay managed by Gemini CLI.
ApplyPack does not store your Google password.
```

Only claim credential behavior that the implementation actually follows.

---

# 142. Existing authentication detection

For a local runner:

```text
Already signed in
```

can be detected.

Then:

```text
Use existing login
```

Do not automatically adopt it without user confirmation.

Multiple local applications may share that account.

---

# 143. Multiple accounts for the same CLI

Supporting two Claude subscriptions or two Google accounts simultaneously is more complicated than supporting multiple providers.

A provider CLI may use one default credential store.

Do not promise arbitrary simultaneous same-provider subscription accounts in Phase 1 unless official profile/config isolation is supported and tested.

Safe Phase 1 rule:

```text
one active subscription CLI connection per provider per local runner
```

while allowing:

```text
multiple API connections
```

if useful.

Design schema without that limitation so it can be expanded later.

---

# 144. Multiple API keys

It may be useful to support:

```text
OpenAI API — Personal
OpenAI API — Work
```

but normal users do not need this immediately.

Allow the data model.

Keep UX simple.

---

# 145. Priority routing across API keys

If several API connections are configured:

```text
OpenAI Project A
OpenAI Project B
```

do not use them to evade provider rate limits or policy restrictions.

Use them only for legitimate separation of projects/accounts and explicit user routing.

---

# 146. Spend provenance

Every estimated cost must point to:

```text
connection
provider
model
task
run
timestamp
```

Never calculate only a global monthly number.

This gives traceability.

---

# 147. Budget UI

Example:

```text
API budget

This month
$6.03 / $25 soft limit

██████░░░░░░░░

Hard stop
$40

[Edit budget]
```

Keep subscription quotas separate.

---

# 148. Cost alert behavior

Examples:

```text
80% of monthly API budget used
```

and:

```text
Paid fallback disabled because the monthly hard limit was reached.
```

Do not automatically increase budgets.

---

# 149. Reconciliation schedule

If official billing-read APIs are configured:

- reconcile periodically;
- do not block application requests waiting for billing data;
- mark reconciled totals with timestamp.

Example:

```text
Provider billing last synced 2h ago
```

---

# 150. Cost-data precision

Store money using decimal/integer micros.

Do not store:

```text
FLOAT
```

for currency.

Example:

```text
estimated_cost_microusd
```

or a database decimal.

---

# 151. Performance metrics

Track:

```text
p50 latency
p95 latency
success rate
schema-valid rate
fallback rate
```

by provider and task.

This makes routing decisions evidence-based.

---

# 152. Quality metrics

For relevant workflows track domain metrics.

Example classification:

```text
precision
recall
false-positive rate
false-negative rate
```

For resume analysis:

```text
unsupported-claim rate
recommendation acceptance rate
user override rate
```

---

# 153. Provider selection should eventually use observed evidence

Long term, routing can use:

```text
task quality
cost
latency
availability
```

But start with user-controlled rules.

Do not build an opaque AI router before there is enough usage data.

---

# 154. Fallback UI history

In Runs:

```text
Resume match

Claude
Started 1:31:14 PM
Quota reached

Gemini
Started 1:31:16 PM
Completed 1:31:27 PM

Selected result: Gemini
```

This will make the new system much easier to debug.

---

# 155. Configuration validation

When saving a routing policy validate:

- at least one enabled connection;
- no disabled connection in active route;
- model compatible with connection;
- compare mode has >= 2 providers;
- paid fallback has budget/confirmation;
- no routing cycles.

---

# 156. Sensible defaults

After connecting providers:

```text
Mode: Single
```

or:

```text
Subscription first
```

if the user explicitly connected several subscription providers.

Do not automatically enable expensive compare mode.

---

# 157. Recommended behavior when all subscriptions fail

If paid API fallback is disabled:

```text
AI providers unavailable

Claude: quota reached
Gemini: temporarily unavailable
Codex: not authenticated

No paid API fallback is enabled.

[Retry]
[Configure AI providers]
```

Clear and predictable.

---

# 158. Recommended behavior when API budget is exceeded

```text
API budget reached

This request was not sent to the OpenAI API.
Subscription providers are currently unavailable.

[Retry later]
[Change budget]
```

No hidden spend.

---

# 159. Model/provider changes during a workflow

For one logical run, pin the selected model/connection at attempt time.

Do not change models halfway through parsing without recording another attempt.

---

# 160. Version history after provider switch

Resume Match history should show provider metadata only as secondary detail:

```text
v10
Score 96
OpenAI · 12 min ago
```

The user-facing score model must remain consistent even when providers differ.

If scores are not calibrated across providers, clearly indicate this and avoid presenting historical score trends as directly comparable.

---

# 161. Cross-provider score calibration

This project uses scores such as resume match percentage.

This is a special risk.

A Claude-generated `95` and Gemini-generated `95` are not automatically equivalent.

Prefer:

- deterministic scoring formula where possible;
- LLM extracts evidence/features;
- application calculates final score.

This greatly improves consistency across providers.

---

# 162. Strong recommendation for scoring architecture

Use AI for:

```text
extract requirements
classify evidence
identify missing evidence
produce structured labels
```

Use application code for:

```text
weighting
score calculation
caps
hard gates
final numeric score
```

Then provider switching does not radically change the meaning of `95`.

This is especially important now that multiple models will be available.

---

# 163. Provider-independent business logic

Keep:

```text
fit thresholds
hard requirement rules
priority overrides
salary rules
location rules
```

outside model prompts wherever possible.

The AI provider should not own core product semantics.

---

# 164. Prompt contract tests

For every provider adapter run the same fixtures and verify:

- required JSON fields;
- enum values;
- missing-value behavior;
- unsupported claims;
- edge cases.

A provider is not considered "supported" just because it returns text.

---

# 165. Migration checklist

Before changing the current code, agents must identify:

- how Claude is authenticated now;
- whether it uses Claude Code CLI, Agent SDK, API, or OAuth token;
- which environment variables are involved;
- whether code runs inside Docker;
- where provider child processes run;
- how AI calls are queued;
- where usage tokens are currently available;
- where model names are hard-coded;
- where prompts are stored;
- where scores are calculated;
- current retry behavior;
- current AI logging.

Do not migrate based on assumptions.

---

# 166. Important investigation: current Claude `.env` auth

The phrase "access to Claude subscription through `.env`" requires special review.

Agents must determine whether the project currently uses:

```text
ANTHROPIC_API_KEY
CLAUDE_CODE_OAUTH_TOKEN
another OAuth credential
Claude Code process authentication
Agent SDK authentication
```

These are not equivalent.

If a subscription OAuth token has been copied into `.env`, treat that as technical debt and move toward provider-owned CLI authentication.

Do not duplicate that token pattern for OpenAI and Google.

---

# 167. Do not generalize an unofficial auth workaround

A critical anti-pattern would be:

```text
Claude subscription works through copied token
therefore
copy ChatGPT token
copy Gemini token
```

Do not do this.

Each provider must have a supported integration path.

---

# 168. Official-supported path principle

For every new adapter document:

```text
Provider
Connection type
Official auth method
Terms/billing mode
Credential owner
Headless support
Usage metadata
Limitations
```

Example:

```text
Google
Gemini CLI subscription
Google login
Subscription quota
Gemini CLI owns credentials
Headless supported
Usage stats available
Local runner required
```

---

# 169. Provider capability registry example

```text
Claude Code subscription
structured output: adapter-enforced
headless: yes
local: yes
billing: subscription
cost per request: not authoritative

OpenAI API
structured output: yes
headless: yes
local/server: yes
billing: metered
usage: token-level

Gemini CLI subscription
structured output: JSON wrapper
headless: yes
local: yes
billing: subscription quota
usage: CLI stats
```

The agent must verify exact features against current installed versions.

---

# 170. Dependency updates

Do not tightly couple business services to SDK packages.

Bad:

```text
ResumeService -> Anthropic SDK
```

Better:

```text
ResumeService
    |
    v
AiGateway
    |
    v
Router
    |
    v
Provider Adapter
```

This is the central refactor.

---

# 171. Suggested service boundaries

```text
AI
├── Gateway
├── Router
├── Connections
├── Providers
│   ├── Anthropic
│   ├── OpenAI
│   └── Google
├── Usage
├── Pricing
├── Budgets
├── Validation
└── Observability
```

Use naming that matches the repository.

---

# 172. Provider adapter should not know product domain

Avoid:

```text
AnthropicResumeMatcher
OpenAiJobClassifier
```

Prefer:

```text
AnthropicAdapter
OpenAiAdapter
```

and domain services build `AiRequest`.

This avoids duplicating business logic three times.

---

# 173. Domain prompt layer

Example:

```text
ResumeMatchPrompt
JobClassifierPrompt
ResumeScanPrompt
```

These feed the common AI gateway.

---

# 174. Testing strategy

Add tests at several levels.

### Unit

- routing;
- fallback;
- budget;
- pricing;
- response normalization;
- error translation;
- schema validation.

### Adapter integration

Mock provider CLI/API.

### Optional live tests

Run only when explicit test credentials are present.

Never require live paid calls for the normal test suite.

---

# 175. CLI adapter tests

Mock child-process execution.

Test:

- executable missing;
- auth missing;
- valid JSON;
- malformed JSON;
- timeout;
- exit code;
- stderr warnings;
- quota message;
- cancellation.

Do not test by invoking real subscriptions in CI.

---

# 176. API adapter tests

Mock HTTP/SDK responses:

```text
200
401
403
429
500
timeout
invalid structured output
usage missing
```

---

# 177. Routing tests

Example:

```text
Claude available
=> Claude selected

Claude quota exhausted + Gemini healthy
=> Gemini selected

Claude timeout + Gemini timeout + API fallback disabled
=> run failed without API spend

subscriptions unavailable + API fallback enabled
=> OpenAI API selected
```

---

# 178. Budget tests

Verify:

- soft alert does not block;
- hard limit blocks;
- subscription calls are not counted as API spend;
- compare mode accounts for all API attempts;
- failed billable attempts follow provider billing semantics conservatively.

---

# 179. UI tests

Playwright/e2e:

- add API connection;
- masked key;
- test connection;
- replace key;
- remove connection;
- connect subscription;
- provider unavailable;
- reorder fallback;
- enable paid fallback;
- set budget;
- task override;
- compare mode warning;
- usage dashboard.

---

# 180. Security tests

Verify:

- secrets never appear in HTML;
- secrets never appear in JSON API responses;
- secrets are redacted from logs;
- secrets are not included in child-process env unnecessarily;
- malicious prompt cannot inject shell arguments;
- frontend cannot choose arbitrary executable;
- local runner rejects unauthenticated callers.

---

# 181. Definition of Done — architecture

- [ ] AI calls no longer directly depend on one Claude implementation.
- [ ] A common AI gateway exists.
- [ ] Providers are implemented behind adapters.
- [ ] Connection and provider are separate concepts.
- [ ] Subscription and API billing modes are separate concepts.
- [ ] Multiple enabled connections can coexist.
- [ ] `.env` is not the primary dynamic AI settings store.
- [ ] Secret values are not stored as plaintext application settings.
- [ ] Subscription OAuth tokens are not copied into the database.
- [ ] Routing decisions are recorded.
- [ ] Logical runs and provider attempts are recorded separately.

---

# 182. Definition of Done — providers

- [ ] Claude subscription connection is supported through a provider-supported Claude Code path where appropriate.
- [ ] Anthropic API key connection is independently supported.
- [ ] ChatGPT/Codex connection is distinct from OpenAI API.
- [ ] OpenAI API key connection is supported.
- [ ] Google AI/Gemini CLI connection is supported.
- [ ] Gemini API connection is supported.
- [ ] Vertex AI can be added without schema redesign.
- [ ] Each adapter has health/error normalization.
- [ ] Provider model selection is not globally hard-coded.

---

# 183. Definition of Done — routing

- [ ] Single mode exists.
- [ ] Ordered fallback exists.
- [ ] Subscription-first exists.
- [ ] Paid API fallback requires explicit user permission.
- [ ] Per-task routing is supported or schema-ready.
- [ ] Rate-limited providers can enter cooldown.
- [ ] Retry storms are prevented.
- [ ] Provider refusal is not treated as infrastructure failure.
- [ ] Compare mode is not enabled by default.
- [ ] Parallel side effects cannot occur.

---

# 184. Definition of Done — cost

- [ ] API requests record provider usage.
- [ ] API requests receive an estimated cost where reliably calculable.
- [ ] Pricing is versioned.
- [ ] Subscription requests are not misleadingly labeled `$0`.
- [ ] API spend can be viewed by provider/task/model.
- [ ] Soft/hard API budgets can be configured.
- [ ] Paid fallback respects the configured budget.
- [ ] Billing reconciliation is optional and does not require admin keys for ordinary usage.

---

# 185. Definition of Done — security

- [ ] Full API keys never return to frontend after save.
- [ ] Keys are masked.
- [ ] Secret storage is encrypted/OS-managed.
- [ ] Subscription credentials remain managed by official clients where possible.
- [ ] CLI processes receive an allowlisted environment.
- [ ] No shell-string concatenation is used.
- [ ] Timeouts/cancellation exist.
- [ ] Local runner is not exposed publicly.
- [ ] Raw AI payload logging is disabled or explicitly controlled.
- [ ] PII and secrets are redacted from logs.

---

# 186. Recommended implementation order

## P0 — investigate and decouple

1. map current Claude integration;
2. map all AI call sites;
3. create AI gateway interface;
4. move existing Claude implementation behind one adapter;
5. preserve current behavior.

Do not add OpenAI/Gemini before this is stable.

## P1 — connection system

1. `ai_connections`;
2. secret storage;
3. Settings > AI Providers;
4. health checks;
5. API key add/test/remove.

## P2 — additional providers

1. OpenAI API;
2. Gemini API;
3. Gemini CLI subscription;
4. Codex subscription transport;
5. normalize usage/errors.

## P3 — routing

1. Single;
2. fallback;
3. subscription-first;
4. per-task override;
5. budgets.

## P4 — usage

1. run/attempt logs;
2. local cost estimation;
3. usage dashboard;
4. optional billing reconciliation.

## P5 — advanced

1. parallel compare;
2. evals;
3. shadow traffic;
4. adaptive routing.

---

# 187. Master agent prompt

Copy this prompt into the orchestrating coding agent.

---

## Prompt

You are the lead architect implementing multi-provider AI support in the ApplyPack repository.

The project currently has a Claude-centric integration and configuration in `.env`. The target architecture must support multiple simultaneous AI connections, including subscription-backed official CLI/harness access where supported and normal pay-as-you-go APIs.

Required provider families:

- Anthropic / Claude
- OpenAI / GPT / Codex
- Google / Gemini

The user may have several connections enabled simultaneously.

Examples:

- Claude subscription through Claude Code;
- Anthropic API key;
- ChatGPT subscription through the supported Codex path;
- OpenAI API key;
- Google AI Pro/Ultra through Gemini CLI;
- Gemini API key;
- future Vertex AI.

### Critical rule: investigate existing Claude auth first

Before changing code, identify exactly how the project currently accesses Claude.

Determine whether it uses:

- `ANTHROPIC_API_KEY`;
- a Claude subscription OAuth credential;
- `CLAUDE_CODE_OAUTH_TOKEN`;
- Claude Code CLI;
- Claude Agent SDK;
- another mechanism.

Do not assume that the current `.env` variable is an API key.

Document the finding in:

```text
docs/ai-provider-audit.md
```

Also inventory every AI call site, prompt, model name, retry mechanism, response parser, queue job and cost/usage field.

### Critical billing/auth distinction

Do not model consumer subscriptions as API keys.

The architecture must distinguish:

```text
provider
connection
transport
auth type
billing mode
```

Examples:

```text
Anthropic + Claude Code + subscription
Anthropic + HTTP API + API key
OpenAI + Codex + ChatGPT account
OpenAI + Responses API + API key
Google + Gemini CLI + Google account
Google + Gemini API + API key
```

Do not copy provider web/session credentials into the application.

Do not scrape consumer web UIs.

Do not extract OAuth tokens from official clients and use them as generic API credentials.

Where subscription usage is supported, invoke the provider through its supported CLI/harness/authentication path.

### `.env`

Stop using `.env` as the primary dynamic AI configuration system.

Keep `.env` for infrastructure/bootstrap configuration.

Store provider connection metadata in Postgres.

Store secrets in a proper secret store:

- OS credential store for local deployments if appropriate;
- KMS/Vault/envelope encryption for server deployment.

Never store API keys as unencrypted ordinary database values.

Do not allow frontend code to receive decrypted secrets.

Support legacy environment-backed credentials temporarily so existing installations do not break.

### AI Gateway

Create a provider-independent gateway.

Conceptually:

```text
Domain service
    -> AiGateway
    -> Router
    -> Provider Adapter
```

Domain services must not directly instantiate Anthropic/OpenAI/Google SDK clients.

Define a normalized request/response contract.

Each adapter should provide concepts equivalent to:

```text
probe
listModels
invoke
capabilities
usageCapabilities
```

### Provider adapters

Implement or plan:

```text
ClaudeCodeAdapter
AnthropicApiAdapter
CodexAdapter
OpenAiApiAdapter
GeminiCliAdapter
GeminiApiAdapter
VertexAiAdapter (schema-ready, may be later)
```

Do not force subscription and API transports into identical authentication code.

### Local CLI runner

If the application/backend runs in Docker while subscription CLIs authenticate on the host, strongly prefer a narrow host-side Local AI Runner rather than broadly mounting provider credential directories into containers.

The local runner must:

- bind only locally or use a Unix socket;
- authenticate ApplyPack requests;
- execute only known provider binaries;
- use process argument arrays, never shell string concatenation;
- use an allowlisted child-process environment;
- enforce timeouts;
- support cancellation;
- not pass unrelated application secrets into provider processes.

For inference-only resume/job tasks, disable provider agent tools/filesystem/shell access where possible.

### Connections

Create an extensible `ai_connections` concept.

Fields should cover concepts such as:

```text
provider
transport
auth_type
label
enabled
status
priority
secret_ref
config
capabilities
last_checked_at
last_success_at
last_error
```

Do not create fixed columns such as:

```text
claude_key
openai_key
gemini_key
```

Multiple connections must be schema-supported.

For Phase 1 it is acceptable to support only one subscription CLI account per provider per local runner if the official CLI does not provide safe multi-profile isolation.

### Task types

Define stable AI task IDs such as:

```text
job_classify
resume_scan
resume_match
resume_suggestions
job_summary
digest_generate
```

Routing must use task types rather than parsing prompt text.

### Routing

Implement these modes in this order:

1. Single
2. Ordered fallback
3. Subscription-first
4. Per-task override

Design for later:

5. Cost-aware
6. Compare / parallel

Subscription-first should allow:

```text
Claude subscription
-> Gemini subscription
-> ChatGPT/Codex
-> optional metered API fallback
```

Paid API fallback must require explicit user opt-in.

Never silently switch from fixed subscription usage to billable API usage.

Allow a daily/monthly API fallback budget.

### Fallback semantics

Fallback on operational failures such as:

- authentication unavailable;
- quota exhausted;
- rate limit;
- timeout;
- provider 5xx;
- model unavailable;
- temporary connectivity error.

Treat refusals separately.

Do not use other providers to automatically bypass a provider refusal.

Set overall max attempts, provider switches and deadlines to prevent retry storms.

### Parallel / Compare

Do not send every request to every provider by default.

Compare mode must be explicit and warn that it consumes quota/cost for each provider.

For read-only analysis, multiple provider outputs may be generated in parallel.

For side-effecting operations, providers may only generate candidates; a single canonical action is committed.

Do not average resume match scores across providers unless scoring is calibrated.

### Scoring architecture

Strongly prefer provider-independent deterministic scoring.

Use AI to extract/classify evidence and application code to calculate:

- hard gates;
- weights;
- final numeric score;
- caps.

This keeps a `95` comparable even when the underlying model changes.

### Structured output

All product AI tasks must use validated schemas.

Normalize provider output into a canonical `AiResponse`.

Do not write provider JSON directly into domain tables.

Pipeline:

```text
provider response
-> parse
-> schema validation
-> repair/retry if allowed
-> canonical result
```

### Models

Do not hard-code one model globally.

Support:

```text
Auto / recommended
Specific model
```

Discover available models through official mechanisms where available and cache results.

Do not scrape model names from consumer sites.

Track capabilities and validate routing requirements.

### Observability

Create separate:

```text
ai_runs
```

for one logical product operation and:

```text
ai_attempts
```

for physical provider calls.

Every attempt should capture where available:

```text
connection
provider
transport
model
status
latency
input tokens
cached input tokens
output tokens
provider request id
fallback reason
estimated cost
actual/reconciled cost
pricing snapshot
```

Never include credentials.

### Cost tracking

For API requests:

1. capture provider usage metadata;
2. calculate local estimated cost;
3. store the pricing snapshot used.

Pricing must be versioned by effective date.

Do not use floating-point currency.

For subscription requests:

- do not show per-call `$0`;
- mark billing mode as Subscription;
- track runs/tokens/quota metadata where available.

Optionally allow the user to configure the monthly fixed subscription amount for project economics, but label it as a configured fixed cost, not per-call provider billing.

Optional later:
- reconcile OpenAI/Anthropic/Google billing using official billing/usage capabilities where available and the user explicitly provides appropriate read/admin access.
- do not require admin billing credentials for normal inference.

### Budgets

Support:

```text
daily API soft limit
daily API hard limit
monthly API soft limit
monthly API hard limit
```

Paid fallback must respect these limits.

Subscription usage and API spend are distinct.

### UI

Create:

```text
Settings / AI Providers
```

The page should show connection cards such as:

```text
Claude subscription
Connected

Google AI subscription
Connected

ChatGPT / Codex
Connected

OpenAI API
Connected · $X estimated this month
```

Add:

```text
+ Connect AI provider
```

Provider setup should explicitly offer the supported connection methods.

OpenAI must clearly state that ChatGPT subscription billing and API billing are separate.

The normal UI should default to `Auto` rather than forcing provider selection on every page.

### Routing UI

Create a clear routing section:

```text
Default mode
Subscription first

Priority
1 Claude
2 Gemini
3 OpenAI

Paid API fallback [on/off]
Daily fallback budget [...]
```

Put per-task routing behind Advanced settings.

### AI Usage

Add a usage view or prepare data for one.

Show separately:

- subscription-backed runs;
- API-backed runs;
- estimated API spend;
- usage by provider;
- usage by task;
- usage by model.

Never combine subscription fixed fees and API charges into one number unless the user explicitly configures subscription allocation.

### Security

Mandatory:

- no plaintext API secrets;
- no secret round-trip to frontend;
- masked keys;
- log redaction;
- no arbitrary executable paths;
- no shell concatenation;
- child process env allowlisting;
- local runner authentication;
- raw prompt/response logging disabled by default;
- safe handling of resume PII;
- key rotation;
- historical usage retained after a connection is removed.

### Testing

Add unit tests for:

- routing;
- fallback;
- cooldown;
- budgets;
- pricing;
- schema validation;
- error normalization.

Mock CLI and API adapters.

Do not require paid provider calls for normal CI.

Add integration/e2e tests for:

- adding API connection;
- testing connection;
- replacing key;
- removing connection;
- subscription connection status;
- priority reorder;
- paid fallback;
- budget;
- provider failure/fallback;
- usage display.

### Evals

Create a future-ready evaluation harness with representative jobs/resumes.

Compare providers per task on:

- output correctness;
- schema validity;
- latency;
- cost;
- unsupported claims.

Do not create a single global "best provider" ranking.

### Required documentation

Produce:

```text
docs/ai-provider-audit.md
docs/ai-provider-architecture.md
docs/ai-provider-security.md
docs/ai-routing.md
```

Update configuration/setup docs.

### Final report

Before declaring completion, provide:

1. current Claude auth mechanism discovered;
2. architecture before/after;
3. connection types implemented;
4. providers implemented;
5. routing modes implemented;
6. secret-storage design;
7. local-runner design if used;
8. cost/usage implementation;
9. migration behavior for existing `.env`;
10. tests run/results;
11. known limitations;
12. screenshots of AI Providers / Routing / Usage UI.

Do not claim that consumer subscriptions provide API credits unless official provider behavior explicitly says so.

---

# 188. Suggested multi-agent orchestration

```text
ORCHESTRATOR
    |
    +--> Current AI/Auth Audit Agent
    |
    +--> Provider/Terms Research Agent
    |
    +--> AI Gateway Architecture Agent
    |
    +--> Security / Secret Storage Agent
    |
    +--> Provider Adapters
    |       ├── Anthropic Agent
    |       ├── OpenAI Agent
    |       └── Google Agent
    |
    +--> Routing / Usage Agent
    |
    +--> Settings UI Agent
    |
    +--> Integration Reviewer
    |
    +--> QA / Security / Evals Agent
```

Important sequencing:

1. current auth audit first;
2. gateway architecture second;
3. secret-storage decision before migrating credentials;
4. adapters may then work in parallel;
5. router integrates only after adapters follow the same contract;
6. UI is built on the real connection/routing semantics;
7. QA tests integrated behavior rather than isolated mocks only.

---

# 189. Recommended concrete product direction

For this project, the best practical target is:

```text
AI Providers

Claude
├── Subscription via Claude Code
└── API key

OpenAI
├── ChatGPT/Codex
└── API key

Google
├── Google AI via Gemini CLI
├── Gemini API key
└── Vertex AI later
```

with:

```text
Routing:
Subscription first
```

and:

```text
Optional paid API fallback
```

plus:

```text
per-task overrides
usage tracking
API cost tracking
budgets
```

This gives the user the flexibility they want without turning provider credentials into unsafe environment-variable hacks.

---

# 190. Final recommendation

The most important principle is:

> **Treat AI access as a set of explicit connections, not a set of environment variables.**

Then keep four concepts separate:

```text
Who?
Provider

How?
Connection / transport / authentication

When?
Routing policy

How much?
Usage / billing / budget
```

If those boundaries are correct, Claude, OpenAI, Gemini, subscriptions, APIs, cloud providers, fallback and future models can all coexist cleanly.

If those boundaries are not created now, adding every new provider will multiply special cases and make billing/security behavior increasingly difficult to understand.

---

# 191. Official sources checked

The implementation agent should re-check current provider documentation at implementation time because authentication, quotas, models and billing behavior change frequently.

## Anthropic

Claude Code with Pro / Max:
https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan

Claude login and subscription authentication guidance:
https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account

Claude Code API-key environment precedence:
https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code

Claude API billing:
https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage

Claude Console cost/usage reporting:
https://support.claude.com/en/articles/9534590-cost-and-usage-reporting-in-the-claude-console

## OpenAI

Using Codex with a ChatGPT plan:
https://help.openai.com/en/articles/11369540-using-codex-with-your-chat

ChatGPT and API billing separation:
https://help.openai.com/en/articles/9039756

OpenAI organization usage/cost API:
https://developers.openai.com/api/reference/python/resources/admin/subresources/organization/subresources/usage

OpenAI API reference:
https://developers.openai.com/api/reference/

## Google

Gemini CLI authentication:
https://geminicli.com/docs/get-started/authentication/

Gemini CLI plans:
https://geminicli.com/plans/

Gemini CLI quotas and pricing:
https://geminicli.com/docs/resources/quota-and-pricing/

Gemini CLI headless mode:
https://geminicli.com/docs/cli/headless/

Gemini CLI automation:
https://geminicli.com/docs/cli/tutorials/automation/

Gemini API billing:
https://ai.google.dev/gemini-api/docs/billing
