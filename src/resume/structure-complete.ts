import { contentKey } from './draft-document';
import type { JsonResume } from './json-resume';
import { structureFromText } from './structure-from-text';

/*
 * Whether an AI reading of a resume is the WHOLE resume (#408). The anchor
 * (structure-anchor.ts) proves that every string the model returned is the
 * resume's own; nothing proved that the model returned all of them. A local
 * model read two of six roles, the anchor kept all 130 strings and dropped
 * none, and the clean version came out four jobs short.
 *
 * The yardstick is the built-in reader (structure-from-text.ts): it cannot
 * pair a skills table, but it loses no line. Each role it finds, and each
 * line under one (a bullet, the role's own paragraph, its stack line), is
 * looked up in the AI reading. Pure — a structure and the text in, counts out.
 */

export interface StructureGaps {
  /** Roles the AI reading holds. */
  roles: number;
  /** Roles the built-in reader finds in the same text. */
  rolesInText: number;
  /** The roles with nothing of theirs in the AI reading, by company (else by title). */
  lostRoles: string[];
  /** Lines the built-in reader finds under the roles, and how many the AI reading lacks. */
  linesInText: number;
  lostLines: number;
}

/** Shorter than this, a line found proves nothing: "PHP" is in every part of a PHP resume. */
const MIN_LINE_KEY = 8;
/** A company or a title may be short ("IBM"), but one letter is not a name. */
const MIN_NAME_KEY = 3;
/**
 * The two readers may cut one line differently — a date the built-in reader
 * left on the end of a bullet, the model filed as the role's dates. A bullet
 * is still there when one string of the AI reading is most of it.
 */
const MOST_OF_IT = 0.6;
/** Lines a reading may lack and still be drawn, with the count said on the page; past this the built-in reading is the better file. */
const LINE_TOLERANCE = 0.1;

function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) stringsOf(v, out);
  return out;
}

export function structureGaps(structure: JsonResume, text: string): StructureGaps {
  const plain = structureFromText(text);
  const keys = stringsOf(structure).map(contentKey).filter((k) => k.length > 0);
  // In the reading's own order with nothing between: a line the model split in two is still one run.
  const bag = keys.join('');
  const holds = (key: string): boolean =>
    bag.includes(key) || keys.some((k) => k.length >= key.length * MOST_OF_IT && key.includes(k));

  const lostRoles: string[] = [];
  let linesInText = 0;
  let lostLines = 0;
  for (const role of plain.work) {
    const lines = [...role.highlights, role.summary, role.after].map((s) => contentKey(s ?? '')).filter((k) => k.length >= MIN_LINE_KEY);
    const lost = lines.filter((k) => !holds(k)).length;
    linesInText += lines.length;
    lostLines += lost;
    // A role is gone when the reading names neither its company nor its title and holds none of its lines.
    const names = [role.name, role.position].map((s) => contentKey(s ?? '')).filter((k) => k.length >= MIN_NAME_KEY);
    const named = names.some((k) => bag.includes(k));
    const gone = !named && (lines.length > 0 ? lost === lines.length : names.length > 0);
    if (gone) lostRoles.push(role.name ?? role.position ?? '');
  }
  return { roles: structure.work.length, rolesInText: plain.work.length, lostRoles, linesInText, lostLines };
}

/**
 * Whether the reading may stand in for the resume: no role gone, and at most
 * a tenth of the lines under the roles. Fewer than that is said on the page
 * and left to the person; a whole job missing from a file they may send is
 * not theirs to spot.
 */
export function structureIsComplete(gaps: StructureGaps): boolean {
  return gaps.lostRoles.length === 0 && gaps.lostLines <= gaps.linesInText * LINE_TOLERANCE;
}
