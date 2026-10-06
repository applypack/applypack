import { promises as fs } from 'node:fs';
import path from 'node:path';

/*
 * The one folder ApplyPack makes for a folder source (ADR 0062): an empty
 * `ApplyPack/inbox` in the home directory, offered on a local install so
 * there is a place no system permission stands in front of. It is created
 * and nothing more: what lands in it is the user's, and is only ever read
 * (datasets/folder-io.ts).
 */
export async function createInbox(home: string): Promise<string> {
  const inbox = path.join(home, 'ApplyPack', 'inbox');
  await fs.mkdir(inbox, { recursive: true });
  return inbox;
}
