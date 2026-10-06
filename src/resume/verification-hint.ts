import { readEvidence } from '../verification/prompts';
import type { MessageKey } from '../i18n/catalog';
import type { MessageParams } from '../i18n/message';
import { t } from '../i18n/t';

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

/**
 * A sentence of ours as a catalog message, for a page that marks the
 * verifier's own words inside it: they arrive in `<en>`, written in English
 * whatever language the page reads in (ADR 0061).
 */
export interface HintMessage {
  key: MessageKey;
  params: MessageParams;
}

const CAUTIONS_MAX = 5;

/** The first thing the verifier held against the posting, if any. */
function leadFlag(v: VerificationForHint): string | null {
  const flag = v.redFlags[0]?.trim();
  if (flag) return flag;
  const bad = readEvidence(v.evidence).find((e) => e.signal === 'ghost' || e.signal === 'scam');
  return bad?.finding.trim() || null;
}

/** One line for the match card and the resume editor's header, as its message. */
export function verificationHintMessage(v: VerificationForHint): HintMessage & { tone: VerificationHint['tone'] } {
  const percent = Math.round(v.confidence);
  // The verifier's own words, when it held something against the posting, ride inside the sentence.
  const flag = leadFlag(v);
  switch (v.recommendation) {
    case 'skip':
      return flag
        ? { tone: 'danger', key: 'match.verification.skipFlag', params: { percent, flag } }
        : { tone: 'danger', key: 'match.verification.skip', params: { percent } };
    case 'caution':
      return flag
        ? { tone: 'warn', key: 'match.verification.cautionFlag', params: { percent, flag } }
        : { tone: 'warn', key: 'match.verification.caution', params: { percent } };
    default:
      return { tone: 'ok', key: 'match.verification.apply', params: { percent } };
  }
}

/** The same line as text. */
export function verificationHint(v: VerificationForHint): VerificationHint {
  const { tone, key, params } = verificationHintMessage(v);
  return { tone, text: t(key, params) };
}

/**
 * The verifier's findings that belong among a comparison's cautions: the
 * posting's red flags and a ghost / scam reading of the posting's own text.
 * Displayed under "Worth knowing — not scored", labelled, never counted by
 * score.ts (a finding about the posting is not a finding about the resume).
 */
export function verificationCautionMessages(v: VerificationForHint): HintMessage[] {
  const lines: HintMessage[] = v.redFlags
    .map((f) => f.trim())
    // A flag with no words says nothing.
    .filter(Boolean)
    .map((text) => ({ key: 'match.verification.from', params: { text } }));
  for (const e of readEvidence(v.evidence)) {
    if (e.check === 'posting_quality' && (e.signal === 'ghost' || e.signal === 'scam')) {
      lines.push({ key: 'match.verification.fromQuality', params: { text: e.finding.trim() } });
    }
  }
  // The same finding twice under one label is said once.
  const seen = new Set<string>();
  return lines
    .filter((l) => {
      const id = `${l.key}\n${l.params.text}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, CAUTIONS_MAX);
}

/** The same findings as text. */
export function verificationCautions(v: VerificationForHint): string[] {
  return verificationCautionMessages(v).map((m) => t(m.key, m.params));
}
