#!/usr/bin/env bash
# Mirrors .claude/settings.json PostToolUse: format the file the agent just
# wrote, resolving the nearest .prettierignore so a worktree edit is not
# skipped by the repo-root `.claude/worktrees/` ignore. See .prettierignore.
set -euo pipefail

file=$(jq -r '.file_path // .filePath // empty')
[ -n "$file" ] || exit 0

d=$(dirname "$file")
while [ "$d" != "/" ] && [ "$d" != "." ] && [ ! -f "$d/.prettierignore" ]; do
  d=$(dirname "$d")
done

if [ -f "$d/.prettierignore" ]; then
  pnpm exec prettier --write --ignore-unknown \
    --ignore-path "$d/.gitignore" \
    --ignore-path "$d/.prettierignore" \
    "$file" >/dev/null 2>&1 || true
else
  pnpm exec prettier --write --ignore-unknown "$file" >/dev/null 2>&1 || true
fi
