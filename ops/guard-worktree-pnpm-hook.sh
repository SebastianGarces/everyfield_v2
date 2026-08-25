#!/usr/bin/env bash
# Claude/Codex PreToolUse adapter for the host-neutral pnpm worktree guard.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // .command // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="${GUARD_WORKTREE_REPO_ROOT:-$root}"

if ! out=$("$root/ops/guard-worktree-pnpm.sh" "$cwd" "$cmd" "$repo_root"); then
  printf '%s\n' "$out" >&2
  exit 2
fi
