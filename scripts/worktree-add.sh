#!/usr/bin/env bash
#
# worktree-add.sh — THE one command that materialises a shell-created track worktree.
#
# `git worktree add` copies tracked files only, so a fresh tree has no
# `.env.local` and every DB-touching suite fails. This wraps that call and then
# runs `scripts/worktree-env.sh` on the new path. Shell/orchestrator loop sites
# go through this script only — never raw `git worktree add`. Codex-managed
# worktrees are created by the app and receive ignored files via
# `.worktreeinclude` instead.
#
# Usage: the same argv as `git worktree add`:
#   scripts/worktree-add.sh -b <branch> <path> <start-point>   # fresh
#   scripts/worktree-add.sh <path> <existing-branch>           # resume
#
# `pnpm install` is a separate agent step — a fresh worktree has no
# `node_modules`, and this script does not install deps.
#
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

# Walk argv the way `git worktree add` does: the first non-option argument is
# the worktree path. Flags that consume a value: -b, -B, --reason.
path=""
expect_value=false
for arg in "$@"; do
  if $expect_value; then
    expect_value=false
    continue
  fi
  case "$arg" in
    -b|-B|--reason) expect_value=true ;;
    --*=*|-*) ;;
    *) path="$arg"; break ;;
  esac
done

if [ -z "$path" ]; then
  echo "worktree-add: usage: $0 [-b <branch>] <path> [<start-point>]" >&2
  exit 2
fi

git worktree add "$@"
"$here/worktree-env.sh" "$path"
