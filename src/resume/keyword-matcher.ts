import path from 'node:path';
import type { MatchKeyword } from './prompts';

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

/** A keyword row plus how many times the posting says it — what orderKeywords returns. */
export type CountedKeyword = MatchKeyword & { count: number };

export interface KeywordMatcher {
  /** Every occurrence of term + aliases in text as whole tokens (see target.mjs). */
  findTerm(text: string, term: string, aliases?: string[]): Span[];
  /**
   * Keyword rows in display order — hardest requirement first, ties broken by
   * how often the posting repeats the term — each carrying that `count`
   * (target-plan.md §5). The panes, the chips and the server-rendered keyword
   * table all order through this one function.
   */
  orderKeywords<T extends { term: string; aliases?: string[] }>(
    keywords: T[],
    jobText: string,
  ): (T & { count: number })[];
}

const MATCHER_PATH = path.resolve('src/web/public/target.mjs');

let matcher: Promise<KeywordMatcher> | undefined;

export function loadKeywordMatcher(): Promise<KeywordMatcher> {
  matcher ??= import(MATCHER_PATH) as Promise<KeywordMatcher>;
  return matcher;
}
