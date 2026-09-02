/**
 * The confirm text for "Delete this resume". Pure so the blast radius can be
 * unit-tested: deleting cascades every comparison AND every cover letter,
 * including the letters the user edited by hand, and the old wording named
 * only the comparisons.
 */

export interface DeleteImpact {
  matches: number;
  letters: number;
}

export function deleteConfirm(name: string, impact: DeleteImpact): string {
  const parts = [
    countOf(impact.matches, 'comparison', 'comparisons'),
    countOf(impact.letters, 'cover letter', 'cover letters'),
  ].filter((p): p is string => p !== null);

  if (parts.length === 0) return `Delete "${name}"? Nothing else is attached to it.`;
  return `Delete "${name}" and ${joinList(parts)}? This cannot be undone.`;
}

function countOf(n: number, one: string, many: string): string | null {
  return n === 0 ? null : `${n} ${n === 1 ? one : many}`;
}

/** "a, b and c" — the last separator is a word, not another comma. */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
