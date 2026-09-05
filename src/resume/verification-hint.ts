import { readEvidence } from '../verification/prompts';

/*
 * What a comparison shows about the stored "Is this job real?" verdict — read,
 * never scored, never stored on the match row (#162, stages 0 and 1). The
 * verifier's own definitions: `caution` = apply, but no more than a light
 * tailoring; `skip` = fake, or clearly dead. Both stayed display-only on the
 * verification card while the comparison ran three minutes later as if the
 * check had never happened. Pure — tested in verification-hint.test.ts.
 */

export interface VerificationForHint {
  recommendation: string;
  confidence: number;
  redFlags: string[];
  /** The stored evidence JSON — read through readEvidence. */
  evidence: unknown;
}

export interface VerificationHint {
  tone: 'ok' | 'warn' | 'danger';
  text: string;
}

const CAUTIONS_MAX = 5;

/** The first thing the verifier held against the posting, if any. */
function leadFlag(v: VerificationForHint): string | null {
  const flag = v.redFlags[0]?.trim();
  if (flag) return flag;
  const bad = readEvidence(v.evidence).find((e) => e.signal === 'ghost' || e.signal === 'scam');
  return bad?.finding.trim() || null;
}

/** One line for the match card and the resume editor's header. */
export function verificationHint(v: VerificationForHint): VerificationHint {
  const pct = `${Math.round(v.confidence)} %`;
  const flag = leadFlag(v);
  switch (v.recommendation) {
    case 'skip':
      return {
        tone: 'danger',
        text: `Verification says skip (${pct})${flag ? `: ${flag}` : ''}. A comparison may be wasted effort — the verifier is fallible, so Compare still works.`,
      };
    case 'caution':
      return {
        tone: 'warn',
        text: `Verification says apply with caution (${pct})${flag ? `: ${flag}` : ''}. A quick check is enough here.`,
      };
    default:
      return { tone: 'ok', text: `Verification says worth applying (${pct}).` };
  }
}

/**
 * The verifier's findings that belong among a comparison's cautions: the
 * posting's red flags and a ghost / scam reading of the posting's own text.
 * Displayed under "Worth knowing — not scored", labelled, never counted by
 * score.ts (a finding about the posting is not a finding about the resume).
 */
export function verificationCautions(v: VerificationForHint): string[] {
  const lines = v.redFlags.map((f) => `From verification: ${f.trim()}`);
  for (const e of readEvidence(v.evidence)) {
    if (e.check === 'posting_quality' && (e.signal === 'ghost' || e.signal === 'scam')) {
      lines.push(`From verification (posting quality): ${e.finding.trim()}`);
    }
  }
  return [...new Set(lines.filter((l) => l.length > 'From verification: '.length))].slice(0, CAUTIONS_MAX);
}
