import { factCheck, type FactClaim } from './fact-check';
import type { ResumeReviewResult } from './prompts';

/*
 * The strength review's "example" rewrites through the fact gate a match
 * suggestion and a letter already pass (TASKS R3, ADR 0020). The prompt asks
 * for rewrites built only from the resume's own facts; this checks that it
 * got them. A blocked example is not shown: the advice keeps its fix, and the
 * fact the rewrite reached for becomes the question — asking is the honest
 * path to a stronger line. Pure: review.ts passes the sources.
 */

type ReviewAdvice = ResumeReviewResult['advice'][number];

/** The question a rewrite that reached past the resume should have asked instead. */
function questionFor(claim: FactClaim): string {
  switch (claim.kind) {
    case 'metric':
      return `The example used ${claim.text}, which the resume does not show. What is the real figure here?`;
    case 'tool':
      return `The example named ${claim.text}, which the resume does not. Did you use it here?`;
    default:
      return `The example named "${claim.text}", which the resume does not show. Is that right?`;
  }
}

/** "GraphQL is never in a bullet", "React is never mentioned in any experience bullet": the term before it is the claim. */
const NEVER_IN_A_BULLET =
  /([\w.+#-]+)\s+(?:is|are)\s+never\s+(?:once\s+)?(?:\w+\s+)?in\s+(?:a|any|one)\s+(?:\w+\s+)?bullets?\b/gi;
const BULLET_LINE = /^\s*[-•*·‣▪]\s+/;

/**
 * A term the advice says no bullet carries, while a bullet of the text does
 * (#584: "GraphQL is never in a bullet", above the bullet that names it). Only
 * this one shape of claim is checked — it can be read off the text exactly;
 * "three roles back" cannot, and is left as the model wrote it.
 */
function falseAbsence(advice: Pick<ReviewAdvice, 'issue' | 'why'>, resumeText: string): string | null {
  const bullets = resumeText.split('\n').filter((l) => BULLET_LINE.test(l));
  for (const [, term] of `${advice.issue}\n${advice.why}`.matchAll(NEVER_IN_A_BULLET)) {
    const word = new RegExp(`(?<![\\w])${term!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i');
    if (bullets.some((b) => word.test(b))) return term!;
  }
  return null;
}

export function gateReviewAdvice(
  advice: readonly ReviewAdvice[],
  /** The resume's text first, then the figures the candidate supplied in earlier answers. */
  sources: string[],
): { advice: ReviewAdvice[]; blocked: number; untrue: number } {
  let blocked = 0;
  // Advice resting on a claim the text contradicts asks for what the resume already does: not shown.
  const [resumeText = ''] = sources;
  const trueAdvice = advice.filter((a) => falseAbsence(a, resumeText) === null);
  const gated = trueAdvice.map((a) => {
    if (!a.example) return a;
    const check = factCheck({ text: a.example, sources });
    if (check.verdict !== 'block') return a;
    blocked++;
    const claim = check.claims.find((c) => c.status === 'unsupported');
    return { ...a, example: null, ask: a.ask ?? (claim ? questionFor(claim) : null) };
  });
  return { advice: gated, blocked, untrue: advice.length - trueAdvice.length };
}
