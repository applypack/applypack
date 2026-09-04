import { blankStyle, type InferredStyle, type Margins, type PageSize } from '../style-infer';

/*
 * What the clean re-render is set in (ADR 0039). Defaults come from the user's
 * own file (style-infer.ts); the form on /resumes/:id/render overrides any of
 * them. NOT stored in v1 — a knob set is one form submit away and storing it
 * would need a column, a migration and a "which resume was this for" question
 * for something the user changes twice.
 */

export const SECTION_KEYS = ['summary', 'skills', 'work', 'projects', 'education', 'certificates', 'languages', 'extras'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** The order a US recruiter reads in, and the order the ATS checklist expects. */
export const DEFAULT_SECTION_ORDER: SectionKey[] = [...SECTION_KEYS];

export const SECTION_LABELS: Record<SectionKey, string> = {
  summary: 'Summary',
  skills: 'Skills',
  work: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certificates: 'Certificates',
  languages: 'Languages',
  extras: '',
};

/** The one bundled family (see fonts/README.md); anything else is the user's own. */
export const BUNDLED_FAMILY = 'Liberation Sans';
/** Families the bundled face is metric-compatible with — naming them is honest. */
export const METRIC_TWINS = ['arial', 'helvetica', 'helvetica neue', 'liberation sans', 'arimo'];

export interface RenderKnobs {
  /** Named in the .docx and shown in the label; the PDF always embeds the bundled face. */
  fontFamily: string;
  bodyPt: number;
  namePt: number;
  headingPt: number;
  /** Six hex digits, no hash. Null renders headings in the body colour. */
  accentHex: string | null;
  margins: Margins;
  sectionOrder: SectionKey[];
  nameCentered: boolean;
  page: PageSize;
}

export const LIMITS = {
  bodyPt: { min: 8, max: 14 },
  namePt: { min: 12, max: 36 },
  headingPt: { min: 8, max: 20 },
  marginIn: { min: 0.3, max: 1.5 },
} as const;

const DEFAULTS: RenderKnobs = {
  fontFamily: 'Arial',
  bodyPt: 10.5,
  namePt: 20,
  headingPt: 11.5,
  accentHex: null,
  margins: { top: 0.5, right: 0.6, bottom: 0.5, left: 0.6 },
  sectionOrder: DEFAULT_SECTION_ORDER,
  nameCentered: true,
  page: 'LETTER',
};

/** The knobs a resume starts with: its own typography where the file said, ours where it did not. */
export function knobsFrom(style: InferredStyle = blankStyle()): RenderKnobs {
  const body = clamp(style.bodyPt ?? DEFAULTS.bodyPt, LIMITS.bodyPt);
  return {
    fontFamily: style.fontFamily ?? DEFAULTS.fontFamily,
    bodyPt: body,
    // A 26 pt name off a Word file is real; over the cap it becomes a banner.
    namePt: clamp(style.namePt ?? DEFAULTS.namePt, LIMITS.namePt),
    headingPt: clamp(style.headingPt ?? Math.round(body + 1), LIMITS.headingPt),
    accentHex: normaliseHex(style.accentHex),
    margins: style.margins ? clampMargins(style.margins) : DEFAULTS.margins,
    sectionOrder: DEFAULT_SECTION_ORDER,
    nameCentered: style.nameCentered ?? DEFAULTS.nameCentered,
    page: style.page ?? DEFAULTS.page,
  };
}

/** Whether the PDF's embedded face will match the named family's metrics. */
export function isMetricTwin(family: string): boolean {
  return METRIC_TWINS.includes(family.trim().toLowerCase());
}

export function normaliseHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.trim().replace(/^#/, '').toLowerCase();
  return /^[0-9a-f]{6}$/.test(hex) ? hex : null;
}

/** Sizes are read to a tenth of a point; margins to a hundredth of an inch,
 * because that is the resolution the corpus's own margins arrive at (0.37 in). */
function clamp(value: number, { min, max }: { min: number; max: number }, places = 1): number {
  if (!Number.isFinite(value)) return min;
  const scale = 10 ** places;
  return Math.round(Math.min(max, Math.max(min, value)) * scale) / scale;
}

function clampMargin(value: number): number {
  return clamp(value, LIMITS.marginIn, 2);
}

function clampMargins(m: Margins): Margins {
  return { top: clampMargin(m.top), right: clampMargin(m.right), bottom: clampMargin(m.bottom), left: clampMargin(m.left) };
}

/**
 * The knobs a form submitted, over the defaults this resume started with.
 * Every field is validated here rather than at the route, so the renderers can
 * assume a sane number and the page can post whatever the user typed.
 */
export function readKnobs(form: Record<string, unknown>, base: RenderKnobs): RenderKnobs {
  const str = (key: string): string | null => {
    const v = form[key];
    return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  };
  const num = (key: string, fallback: number, limits: { min: number; max: number }): number => {
    const raw = str(key);
    return raw === null ? fallback : clamp(Number(raw), limits);
  };
  const family = str('fontFamily');
  const margin = (key: string, fallback: number): number => {
    const raw = str(key);
    return raw === null ? fallback : clampMargin(Number(raw));
  };
  return {
    fontFamily: family ? family.slice(0, 60) : base.fontFamily,
    bodyPt: num('bodyPt', base.bodyPt, LIMITS.bodyPt),
    namePt: num('namePt', base.namePt, LIMITS.namePt),
    headingPt: num('headingPt', base.headingPt, LIMITS.headingPt),
    // An empty accent field means "no accent", which is why it is not `?? base`.
    accentHex: 'accentHex' in form ? normaliseHex(str('accentHex')) : base.accentHex,
    margins: {
      top: margin('marginTop', base.margins.top),
      right: margin('marginRight', base.margins.right),
      bottom: margin('marginBottom', base.margins.bottom),
      left: margin('marginLeft', base.margins.left),
    },
    sectionOrder: readOrder(str('sectionOrder')) ?? base.sectionOrder,
    // A checkbox that is off sends nothing, so absence is false, not "unchanged".
    nameCentered: form.nameCentered === undefined ? false : form.nameCentered !== 'off',
    page: str('page') === 'A4' ? 'A4' : str('page') === 'LETTER' ? 'LETTER' : base.page,
  };
}

/** A comma-separated order, with anything missing appended so no section is lost. */
export function readOrder(value: string | null): SectionKey[] | null {
  if (value === null) return null;
  const asked = value
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SectionKey => (SECTION_KEYS as readonly string[]).includes(s));
  if (asked.length === 0) return null;
  const seen = new Set(asked);
  return [...asked, ...SECTION_KEYS.filter((k) => !seen.has(k))];
}
