#!/usr/bin/env sh
# Snapshot GitHub repo statistics into dated JSON files.
# GitHub keeps traffic data (views, clones, referrers) for 14 days only, so
# run this at least every two weeks (cron or by hand).
#
# Usage: scripts/archive-traffic.sh [output-dir]
# Requires: gh (authenticated), jq.
set -eu

REPO="${REPO:-nazboyko/job-hunter}"
OUT="${1:-$HOME/job-hunter-evidence/traffic}"
DATE="$(date +%Y-%m-%d)"

mkdir -p "$OUT"

gh api "repos/$REPO" \
  --jq '{date: "'"$DATE"'", stars: .stargazers_count, forks: .forks_count, watchers: .subscribers_count, open_issues: .open_issues_count}' \
  > "$OUT/$DATE-repo.json"
gh api "repos/$REPO/traffic/views"     > "$OUT/$DATE-views.json"
gh api "repos/$REPO/traffic/clones"    > "$OUT/$DATE-clones.json"
gh api "repos/$REPO/traffic/popular/referrers" > "$OUT/$DATE-referrers.json"
gh api "repos/$REPO/traffic/popular/paths"     > "$OUT/$DATE-paths.json"
# star+json media type adds starred_at — a dated star beats a bare login.
gh api -H "Accept: application/vnd.github.star+json" "repos/$REPO/stargazers" \
  --paginate --jq '.[] | "\(.starred_at)  \(.user.login)"' > "$OUT/$DATE-stargazers.txt"

jq -c . "$OUT/$DATE-repo.json"
echo "views:  $(jq '.count' "$OUT/$DATE-views.json") (unique $(jq '.uniques' "$OUT/$DATE-views.json"))"
echo "clones: $(jq '.count' "$OUT/$DATE-clones.json") (unique $(jq '.uniques' "$OUT/$DATE-clones.json"))"
echo "saved to $OUT"
