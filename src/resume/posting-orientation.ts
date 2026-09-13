import { clipWords } from '../text-utils';
import type { PostingBrief } from './prompts';

/*
 * What this posting IS, in three short lines — the sector it sits in, what the
 * employer sells, and who reads the resume first.
 *
 * Every line is a field the posting brief already wrote (ADR 0044) and no page
 * ever showed. The comparison told a candidate how well their words matched
 * and nothing about the employer behind the words: a PHP/Laravel posting at a
 * radio network, at a clinic and at an online casino ask for the same stack
 * and want completely different evidence of it, and the only way to learn
 * which one this was is to read the description the comparison already read.
 *
 * Nothing here is inferred and nothing is scored. A field the brief left null
 * produces no line, so a thin posting says less rather than guessing more —
 * the same rule brief-depth.ts follows, and the reason there is no "what this
 * sector usually expects" line: that would be our guess wearing the
 * employer's voice.
 *
 * Pure. The stored brief arrives as an argument; no call, no column.
 */

export interface OrientationRow {
  label: string;
  text: string;
}

/** Long enough for a sector and a product, short enough to take in at a glance. */
const MAX_ROW_CHARS = 130;

/** A nullable brief field as a string. `clipWords` collapses the whitespace. */
function tidy(text: string | null | undefined): string {
  return (text ?? '').trim();
}

/** What the brief has to carry for an orientation to be worth rendering. */
type OrientationBrief = Pick<PostingBrief, 'role' | 'company' | 'screening'>;

export function postingOrientation(brief: OrientationBrief | null | undefined): OrientationRow[] {
  if (!brief) return [];
  const rows: OrientationRow[] = [];

  const industry = tidy(brief.company.industry);
  const stage = tidy(brief.company.stage);
  // "agency · agency" helps nobody: the stage earns a place only when the
  // industry line does not already carry the word.
  const repeated = stage !== '' && industry.toLowerCase().includes(stage.toLowerCase());
  const sector = [industry, repeated ? '' : stage].filter(Boolean).join(' · ');
  if (sector !== '') rows.push({ label: 'Sector', text: clipWords(sector, MAX_ROW_CHARS) });

  // The product is what the employer sells; the role's focus is what this
  // person would do about it. They overlap enough that showing both is one
  // line of repetition, and the product is the one a stack cannot tell you.
  const product = tidy(brief.company.product);
  const focus = tidy(brief.role.focus);
  if (product !== '') rows.push({ label: 'The product', text: clipWords(product, MAX_ROW_CHARS) });
  else if (focus !== '') rows.push({ label: 'The work', text: clipWords(focus, MAX_ROW_CHARS) });

  const reader = tidy(brief.screening.reader);
  if (reader !== '') rows.push({ label: 'Read first by', text: clipWords(reader, MAX_ROW_CHARS) });

  return rows;
}
