/*
 * One body limit for every POST that is not an upload. The upload routes set
 * their own, larger ceilings inline (5 MB for a resume, 200 MB for a batch of
 * applicants), and a global limit would reject those bodies before the route
 * saw them — so it steps aside on exactly those paths (audit 2026-09-10,
 * SEC-8). Add a route here when it gets its own bodyLimit.
 */

export const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;

const OWN_LIMIT = [
  /^\/resumes$/,
  /^\/resumes\/\d+\/replace$/,
  /^\/target$/,
  /^\/letter$/,
  /^\/jobs\/\d+\/target\/reupload$/,
  /^\/settings\/profiles\/\d+\/fill-from-resume$/,
  /^\/welcome\/resume$/,
  /^\/screen$/,
  /^\/screen\/\d+\/applicants$/,
];

/** True for a POST whose route carries its own upload ceiling. */
export function hasOwnBodyLimit(method: string, path: string): boolean {
  return method === 'POST' && OWN_LIMIT.some((re) => re.test(path));
}
