import { emptyResume, type JsonResume } from './json-resume';

/*
 * Persist-time verbatim guard for the scan's `structure` block (ADR 0039),
 * the same idea as keyword-anchor.ts one layer over: the prompt asks the
 * model to COPY the resume into a shape, and this pass checks that it did.
 *
 * Every string in the structure has to be a contiguous span of the resume
 * text after normalisation. One that is not was written, not copied — a
 * tightened bullet, an expanded abbreviation, a job title the model thought
 * was better — and a renderer that printed it would hand the candidate a
 * resume they never wrote. Unanchored strings are dropped; the counts come
 * back so the log can carry the regression metric for a prompt bump.
 *
 * Pure — text and structure in, structure and a report out.
 */

export interface AnchorStructureReport {
  structure: JsonResume;
  /** Strings that were a verbatim span of the resume. */
  kept: number;
  /** Strings the model wrote rather than copied, now gone. */
  dropped: number;
  /** Roles whose every bullet was dropped — the shape of a bad reply, worth saying. */
  emptiedRoles: number;
  /** The first few dropped strings, for the log line. */
  samples: string[];
}

const MAX_SAMPLES = 5;
/**
 * Below this, an "anchor" proves nothing — two characters occur in every
 * resume — so short strings are kept without being counted as evidence.
 */
const MIN_ANCHOR_CHARS = 3;

/**
 * One normalisation for both sides. Whitespace collapses (a PDF breaks a
 * bullet mid-sentence, a .docx separates a tabbed header with a tab), the
 * dash and quote families flatten (Word's smart quotes against a model's
 * straight ones), and case is ignored: a heading the model title-cases is
 * still the resume's own words.
 */
export function normaliseForAnchor(text: string): string {
  return text
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Drops every string the resume does not contain, and reports what went. */
export function anchorStructure(structure: JsonResume, resumeText: string): AnchorStructureReport {
  const haystack = normaliseForAnchor(resumeText);
  let kept = 0;
  let dropped = 0;
  const samples: string[] = [];

  const anchored = (value: string | null): string | null => {
    if (value === null) return null;
    const needle = normaliseForAnchor(value);
    if (needle.length === 0) return null;
    if (needle.length < MIN_ANCHOR_CHARS || haystack.includes(needle)) {
      kept++;
      return value;
    }
    dropped++;
    if (samples.length < MAX_SAMPLES) samples.push(value);
    return null;
  };
  const list = (values: string[]): string[] => values.map((v) => anchored(v)).filter((v): v is string => v !== null);

  const out = emptyResume();
  const b = structure.basics;
  out.basics = {
    name: anchored(b.name),
    label: anchored(b.label),
    email: anchored(b.email),
    phone: anchored(b.phone),
    url: anchored(b.url),
    location: anchored(b.location),
    summary: anchored(b.summary),
    profiles: list(b.profiles),
  };

  let emptiedRoles = 0;
  for (const w of structure.work) {
    const highlights = list(w.highlights);
    if (w.highlights.length > 0 && highlights.length === 0) emptiedRoles++;
    out.work.push({
      name: anchored(w.name),
      position: anchored(w.position),
      location: anchored(w.location),
      startDate: anchored(w.startDate),
      endDate: anchored(w.endDate),
      summary: anchored(w.summary),
      highlights,
    });
  }
  for (const e of structure.education) {
    out.education.push({
      institution: anchored(e.institution),
      area: anchored(e.area),
      studyType: anchored(e.studyType),
      startDate: anchored(e.startDate),
      endDate: anchored(e.endDate),
      score: anchored(e.score),
    });
  }
  for (const s of structure.skills) out.skills.push({ name: anchored(s.name), keywords: list(s.keywords) });
  for (const l of structure.languages) out.languages.push({ language: anchored(l.language), fluency: anchored(l.fluency) });
  for (const c of structure.certificates) {
    out.certificates.push({ name: anchored(c.name), issuer: anchored(c.issuer), date: anchored(c.date) });
  }
  for (const p of structure.projects) {
    out.projects.push({
      name: anchored(p.name),
      description: anchored(p.description),
      url: anchored(p.url),
      highlights: list(p.highlights),
    });
  }
  for (const x of structure.extras) {
    const heading = anchored(x.heading);
    // extras.heading is required by the schema, so a dropped one takes the
    // section: a heading the resume does not contain has nothing under it.
    if (heading !== null) out.extras.push({ heading, lines: list(x.lines) });
  }

  return { structure: prune(out), kept, dropped, emptiedRoles, samples };
}

/** Entries left with nothing at all after the guard are not entries. */
function prune(resume: JsonResume): JsonResume {
  const some = (...vs: Array<string | null | string[]>) =>
    vs.some((v) => (Array.isArray(v) ? v.length > 0 : v !== null));
  return {
    ...resume,
    work: resume.work.filter((w) => some(w.name, w.position, w.summary, w.highlights)),
    education: resume.education.filter((e) => some(e.institution, e.area, e.studyType)),
    skills: resume.skills.filter((s) => some(s.name, s.keywords)),
    languages: resume.languages.filter((l) => some(l.language)),
    certificates: resume.certificates.filter((c) => some(c.name)),
    projects: resume.projects.filter((p) => some(p.name, p.description, p.highlights)),
    extras: resume.extras.filter((x) => x.lines.length > 0),
  };
}

/**
 * Whether a guarded structure is worth storing. A reply the guard emptied is
 * not better than the deterministic fallback, and pretending otherwise would
 * put a blank render page in front of the user.
 */
export function structureIsUsable(report: AnchorStructureReport): boolean {
  const s = report.structure;
  return s.work.length > 0 || s.skills.length > 0 || s.basics.summary !== null;
}
