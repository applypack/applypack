#!/bin/bash
# blocks git commit if the previous commit was under 120 seconds ago
input=$(cat)
echo "$input" | grep -q "git commit" || exit 0
last=$(git log -1 --format=%ct 2>/dev/null || echo 0)
now=$(date +%s)
gap=$((now - last))
if [ "$last" != "0" ] && [ "$gap" -lt 120 ]; then
  echo "last commit was ${gap}s ago, keep working and commit the next finished unit later, batch commits look machine made" >&2
  exit 2
fi
exit 0
