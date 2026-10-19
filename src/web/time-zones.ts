/*
 * The time-zone picker's names (#572). The runtime lists zones under CLDR's
 * spellings, which kept names IANA has since replaced: a person looks for
 * Kyiv and Kolkata, and found Europe/Kiev and Asia/Calcutta. The picker
 * offers the current names; a zone stored under an old one keeps working —
 * Intl reads both — and is shown under its new name.
 */

/** CLDR's spelling → IANA's current name, for the zones renamed since. */
export const RENAMED_ZONES: Readonly<Record<string, string>> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Coral_Harbour': 'America/Atikokan',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

/** The install's default when no zone is set (`config.ts:TZ`); the runtime's list leaves it out. */
const UTC = 'UTC';

/** A zone under its current name, whatever spelling it came in ("europe/kiev", "Asia/Calcutta"); null when the runtime does not know it. */
export function canonicalZone(zone: string): string | null {
  try {
    const id = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
    return RENAMED_ZONES[id] ?? id;
  } catch {
    return null;
  }
}

let known: readonly string[] | null = null;

/** Every zone the runtime knows, under current names, in order: the picker's suggestions. */
export function timeZoneChoices(): readonly string[] {
  known ??= [...new Set([...Intl.supportedValuesOf('timeZone'), UTC].map((z) => canonicalZone(z) ?? z))].sort();
  return known;
}

/**
 * What a person typed into the picker, as a zone: a name in any spelling, or
 * a city that names one zone ("kyiv", "New York"). Anything else comes back
 * as typed, for the schedule's check to refuse in words.
 */
export function readZone(typed: string): string {
  const text = typed.trim();
  const zone = text === '' ? null : canonicalZone(text);
  if (zone) return zone;
  const city = `/${text.toLowerCase().replace(/\s+/g, '_')}`;
  const named = timeZoneChoices().filter((z) => z.toLowerCase().endsWith(city));
  return named.length === 1 ? named[0]! : text;
}
