import path from 'node:path';

/*
 * The keyword matcher is the browser module src/web/public/target.mjs — ONE
 * implementation for the /target page, node:test and the server, nothing to
 * mirror. Loaded from the working directory, the same way web/server.ts serves
 * that directory as /static/ (the runtime image copies it next to dist/).
 */

export interface Span {
  start: number;
  end: number;
}

export interface KeywordMatcher {
  /** Every occurrence of term + aliases in text as whole tokens (see target.mjs). */
  findTerm(text: string, term: string, aliases?: string[]): Span[];
}

const MATCHER_PATH = path.resolve('src/web/public/target.mjs');

let matcher: Promise<KeywordMatcher> | undefined;

export function loadKeywordMatcher(): Promise<KeywordMatcher> {
  matcher ??= import(MATCHER_PATH) as Promise<KeywordMatcher>;
  return matcher;
}
