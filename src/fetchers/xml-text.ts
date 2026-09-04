/**
 * Reading rss-parser custom fields. A simple element arrives as a string;
 * an element with children arrives as xml2js's node — children as arrays,
 * the text of a node with attributes under `_`. Pure, shared by the feeds
 * that declare their own namespaces (Landing.jobs `lj:`, Teamtailor `tt:`).
 */

/** A child of an xml2js element node, if the node is one. */
export function nested(node: unknown, key: string): unknown {
  return node !== null && typeof node === 'object' && key in node ? (node as Record<string, unknown>)[key] : undefined;
}

/** Every child of that name, as an array (xml2js keeps repeated elements as arrays). */
export function nestedAll(node: unknown, key: string): unknown[] {
  const value = nested(node, key);
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** The text of an xml2js value: a string, the first of an array, or a node's `_`. */
export function firstText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return firstText(value[0]);
  if (value !== null && typeof value === 'object' && '_' in value) return firstText((value as { _: unknown })._);
  return '';
}
