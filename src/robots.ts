/**
 * robots.txt, as RFC 9309 defines it plus the one rule this project adds
 * (TASKS §17, ADR 0036). Pure: the caller fetches the file, this decides.
 *
 * Until now the ADR 0005 addendum was enforced by hand — a person read each
 * vendor's robots.txt once and wrote the verdict into the register. The
 * watchlist fetches hosts nobody vetted, so the same reading has to happen in
 * code, on every host, before the first request for its jobs.
 *
 * Two deliberate departures from the RFC, both in the direction of asking for
 * less than the protocol allows:
 *
 * 1. **More than one group can bind us.** RFC 9309 §2.2.1 says a crawler
 *    picks the one group matching its own product token and ignores the rest.
 *    We take the strictest verdict across our own token, `*`, and the crawler
 *    tokens of **the AI backend this install actually runs** — because every
 *    description we fetch is read by that vendor's model, so a `Disallow`
 *    aimed at that crawler is aimed at what we are about to do, whatever name
 *    we ask under (ADR 0005 addendum rule 2).
 *
 *    Which tokens those are is the caller's to say (`ai-engine.ts:
 *    aiCrawlerTokens`), and the narrowing is measured, not theoretical:
 *    binding on every AI token in existence refused 3 of 16 European
 *    companies on 2026-09-04, each of which had named only a scraper
 *    (Bytespider) or a dataset crawler (CCBot). One of them, Software
 *    Mansion, published `Content-Signal: ai-input=yes` in the same file.
 * 2. **A 5xx means not allowed.** The RFC lets a crawler treat an
 *    unreachable robots.txt as full allow after a while. A server that is
 *    failing has not told us anything, and this is a personal tool checking
 *    one careers page — waiting costs the user nothing.
 *
 * A missing file (404 / 410) IS allow-all: that is the protocol's own answer
 * and the overwhelming majority of career hosts serve nothing.
 *
 * On top of the RFC this reads Cloudflare's `Content-Signal`, because it
 * speaks about the act rather than about a crawler's name: `ai-input=no` is a
 * refusal of exactly what this project does with a description, and
 * `ai-input=yes` is a permission that outranks a group aimed at somebody
 * else's bot.
 */

/** Our own product token — the first word of DEFAULT_USER_AGENT. */
export const OUR_TOKEN = 'applypack';

/**
 * Our own token plus the vendor crawlers of the engines this install runs.
 * `ai-engine.ts:aiCrawlerTokens` produces the second half; passing none means
 * only our own token and `*` bind, which is the plain RFC reading.
 */
export function bindingTokens(aiTokens: readonly string[] = []): string[] {
  return [...new Set([OUR_TOKEN, ...aiTokens.map((t) => t.toLowerCase())])];
}

interface Rule {
  allow: boolean;
  /** The raw path pattern, `*` and `$` included. */
  pattern: string;
}

export interface RobotsGroup {
  /** Lower-cased user-agent values this group addresses. */
  agents: string[];
  rules: Rule[];
}

export interface Robots {
  groups: RobotsGroup[];
  /**
   * Cloudflare's `Content-Signal`, as the file states it: `ai-input`,
   * `ai-train`, `search` → true / false. Only `ai-input` is read here, and
   * only the last value in the file wins — the signal is about the site, not
   * about one group.
   */
  signals: Record<string, boolean>;
}

export const ALLOW_ALL: Robots = { groups: [], signals: {} };

/**
 * Parse robots.txt into groups. Consecutive `User-agent` lines share the
 * rules that follow them; a rule line starts a new group's body, so a second
 * `User-agent` after a rule begins a new group (RFC 9309 §2.2.1).
 *
 * Everything unrecognised — `Sitemap`, `Crawl-delay`, `Host`, junk — is
 * skipped rather than guessed at. `Crawl-delay` is not read here on purpose:
 * pacing lives in `fetchers/source-order.ts`, where one hand-checked entry is
 * still the honest state (ADR 0035).
 */
export function parseRobots(text: string): Robots {
  const groups: RobotsGroup[] = [];
  const signals: Record<string, boolean> = {};
  let current: RobotsGroup | null = null;
  // True while we are still collecting the agent lines that open a group.
  let collectingAgents = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (!collectingAgents || current === null) {
        current = { agents: [], rules: [] };
        groups.push(current);
        collectingAgents = true;
      }
      if (value.length > 0) current.agents.push(value.toLowerCase());
      continue;
    }
    if (field === 'content-signal') {
      // `search=yes, ai-input=yes, ai-train=no` — anything but an explicit
      // yes/no is skipped rather than guessed at.
      for (const part of value.split(',')) {
        const [k, v] = part.split('=').map((x) => x.trim().toLowerCase());
        if (k && (v === 'yes' || v === 'no')) signals[k] = v === 'yes';
      }
      continue;
    }
    if (field !== 'allow' && field !== 'disallow') continue;
    // A rule before any user-agent line addresses nobody; the RFC says to
    // ignore it, and so does every major implementation.
    if (current === null) continue;
    collectingAgents = false;
    // `Disallow:` with an empty value means "nothing is disallowed" — it is a
    // rule that matches nothing, which is what an empty pattern already does.
    // An empty `Allow:` is undefined in the RFC; treated the same.
    if (value.length === 0) continue;
    current.rules.push({ allow: field === 'allow', pattern: value });
  }
  return { groups, signals };
}

/**
 * The rules that apply to one token: its own groups if it has any, otherwise
 * the `*` groups. Never both — RFC 9309 §2.2.1 is explicit that a named group
 * REPLACES the wildcard for that crawler, and merging them would let a site
 * that says `Disallow: /` to ClaudeBot and `Allow: /` to everyone come out
 * allowed on the tie.
 *
 * Several groups may name the same token (a file can repeat itself); those
 * are merged, which is what the RFC says to do.
 */
function rulesFor(robots: Robots, token: string): Rule[] {
  const own = robots.groups.filter((g) => g.agents.includes(token));
  const groups = own.length > 0 ? own : robots.groups.filter((g) => g.agents.includes('*'));
  return groups.flatMap((g) => g.rules);
}

/**
 * Length of the longest rule pattern that matches this path, per RFC 9309
 * §2.2.2 ("the most specific match wins"), or -1 when none does.
 */
function matchLength(rules: readonly Rule[], path: string, allow: boolean): number {
  let best = -1;
  for (const rule of rules) {
    if (rule.allow !== allow) continue;
    if (!pathMatches(rule.pattern, path)) continue;
    // `$` anchors and does not add specificity; `*` stands for what it ate,
    // and the RFC compares the pattern's own octet length, so this is it.
    if (rule.pattern.length > best) best = rule.pattern.length;
  }
  return best;
}

/**
 * RFC 9309 §2.2.3 path matching: a prefix match, with `*` for any run of
 * characters and `$` anchoring the end. Everything else is literal.
 */
export function pathMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}

export interface RobotsVerdict {
  allowed: boolean;
  /** Which agent token's group refused, when one did. */
  refusedBy?: string;
  /** One sentence for the screen. Empty when allowed. */
  reason: string;
}

/**
 * Is this path allowed to us? The strictest answer across the tokens given,
 * each resolved the way the RFC resolves it: the token's own group if it has
 * one, else `*`; then the longest matching pattern wins, and a tie goes to
 * Allow.
 *
 * `Content-Signal` is read first, because it speaks about the act rather than
 * about a crawler's name. `ai-input=no` refuses us outright. `ai-input=yes` is
 * a permission, so the vendor-crawler tokens are dropped and only our own
 * token and `*` decide the path — the case Software Mansion publishes:
 * `Allow: /` and `ai-input=yes` for everyone, `Disallow: /` for Bytespider.
 */
export function isAllowed(robots: Robots, path: string, tokens: readonly string[]): RobotsVerdict {
  if (robots.signals['ai-input'] === false) {
    return {
      allowed: false,
      reason: `This site publishes "Content-Signal: ai-input=no" — every posting here would be read by an AI, so that refusal covers us (ADR 0005).`,
    };
  }
  const binding = robots.signals['ai-input'] === true ? [OUR_TOKEN] : tokens;
  for (const token of binding) {
    const rules = rulesFor(robots, token);
    if (rules.length === 0) continue;
    const allow = matchLength(rules, path, true);
    const disallow = matchLength(rules, path, false);
    // Ties go to Allow — the RFC's rule, and the one that makes
    // `Disallow: /api/` + `Allow: /api/v2` behave as 4dayweek.io intends.
    if (disallow > allow) {
      return {
        allowed: false,
        refusedBy: token,
        reason:
          token === OUR_TOKEN
            ? `This site's robots.txt asks crawlers not to fetch ${path}.`
            : `This site's robots.txt tells ${token} not to fetch ${path} — every posting here would be read by an AI classifier, so that refusal covers us (ADR 0005).`,
      };
    }
  }
  return { allowed: true, reason: '' };
}

/**
 * The whole check from one HTTP answer. `status` is what the robots.txt
 * request returned and `body` what it carried; a network failure is a 0.
 */
export function robotsAllows(
  status: number,
  body: string,
  path: string,
  tokens: readonly string[],
): RobotsVerdict {
  // The protocol's own answer: nothing published means nothing refused.
  if (status === 404 || status === 410) return { allowed: true, reason: '' };
  if (status >= 400 && status < 500) return { allowed: true, reason: '' };
  if (status < 200 || status >= 300) {
    return {
      allowed: false,
      reason: `Could not read that site's robots.txt (HTTP ${status || 'no answer'}) — nothing is fetched until it says we may.`,
    };
  }
  return isAllowed(parseRobots(body), path, tokens);
}
