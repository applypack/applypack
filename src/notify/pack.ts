/*
 * Blocks under a header, packed into messages no longer than `limit`. A
 * block that alone exceeds the limit goes out on its own — whether the
 * channel truncates or rejects it is the channel's call. Pure.
 */
export function packMessages(header: string, blocks: readonly string[], separator: string, limit: number): string[] {
  const out: string[] = [];
  let buf = header;
  for (const block of blocks) {
    const candidate = buf.length === 0 ? block : `${buf}${separator}${block}`;
    if (candidate.length > limit) {
      out.push(buf);
      buf = block;
    } else {
      buf = candidate;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}
