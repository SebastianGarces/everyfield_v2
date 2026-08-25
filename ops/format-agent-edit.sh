#!/usr/bin/env bash
# Shared formatter adapter for Claude, Cursor, and Codex edit hooks.
#
# Each host sends a different JSON shape. This adapter extracts only the files
# named by the edit that just completed, then runs the repository's configured
# Prettier against those files. It deliberately does not sweep git status: the
# checkout may already contain unrelated user changes.
set -euo pipefail

mode="${1:-format}"
if [ "$mode" != "format" ] && [ "$mode" != "--list" ]; then
  echo "usage: $0 [--list]" >&2
  exit 2
fi

input=$(cat)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
cwd="${cwd:-$PWD}"

edited_paths() {
  # Cursor and Claude Write/Edit events expose a direct path.
  printf '%s' "$input" | jq -r '
    .file_path?,
    .filePath?,
    .tool_response.filePath?,
    .tool_input.file_path?
    | select(type == "string" and length > 0)
  '

  # Codex apply_patch exposes the patch as tool_input.command. One patch can
  # touch several files, so extract every added, updated, or moved-to path.
  printf '%s' "$input" |
    jq -r '.tool_input.command // empty' |
    sed -nE \
      -e 's/^\*\*\* (Add|Update) File: (.*)$/\2/p' \
      -e 's/^\*\*\* Move to: (.*)$/\1/p'
}

if [ "$mode" = "--list" ]; then
  edited_paths | awk 'NF && !seen[$0]++'
  exit 0
fi

if ! root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null); then
  exit 0
fi

edited_paths | awk 'NF && !seen[$0]++' | while IFS= read -r file; do
  case "$file" in
    /*) candidate="$file" ;;
    *) candidate="$cwd/$file" ;;
  esac

  [ -f "$candidate" ] || continue
  absolute="$(cd "$(dirname "$candidate")" && pwd -P)/$(basename "$candidate")"

  # A project hook formats project files only, even if a malformed event names
  # something outside the checkout.
  case "$absolute" in
    "$root"/*) ;;
    *) continue ;;
  esac

  d=$(dirname "$absolute")
  while [ "$d" != "/" ] && [ ! -f "$d/.prettierignore" ]; do
    d=$(dirname "$d")
  done

  if [ -f "$d/.prettierignore" ]; then
    (
      cd "$root"
      pnpm exec prettier --write --ignore-unknown \
        --ignore-path "$d/.gitignore" \
        --ignore-path "$d/.prettierignore" \
        "$absolute"
    ) >/dev/null 2>&1 || true
  else
    (cd "$root" && pnpm exec prettier --write --ignore-unknown "$absolute") \
      >/dev/null 2>&1 || true
  fi
done
