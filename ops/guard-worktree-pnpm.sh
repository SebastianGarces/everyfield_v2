#!/usr/bin/env bash
# Guard against the worktree/node_modules entanglement (2026-08-20, repro'd).
#
# The bug being fenced: a worktree whose node_modules is a SYMLINK to the parent
# checkout's. `pnpm install` run through that symlink realpaths the modules dir
# to the parent but computes the virtual store through the worktree path, so it
# rewires the PARENT's top-level links to targets like
#   ../.claude/worktrees/<name>/node_modules/.pnpm/<pkg>/...
# Everything resolves while the worktree exists; deleting it breaks the parent
# silently (40 dead links on 2026-08-19). pnpm runs root lifecycle scripts only
# AFTER rewiring, so a preinstall check cannot prevent this — it must be blocked
# before pnpm starts. This script is that block, called from the Claude
# PreToolUse hook and the Cursor beforeShellExecution hook.
#
# Interface: guard-worktree-pnpm.sh <cwd> <command-string>
#   exit 0            → allow
#   exit 1 + stdout   → block, stdout is the reason (hooks relay it to the agent)
set -euo pipefail

cwd="${1:-}"
cmd="${2:-}"
[ -n "$cmd" ] || exit 0

block() {
  printf '%s\n' "$1"
  exit 1
}

# Rule 1 — creating the poison: a symlink named node_modules, or one pointing
# at a node_modules. `ln -s` in any argument order.
if printf '%s' "$cmd" | grep -qE '(^|[;|&[:space:]])ln[[:space:]]+-[A-Za-z]*s[A-Za-z]*[[:space:]][^;|&]*node_modules'; then
  block "Blocked: never symlink node_modules between checkouts. A later pnpm install through the symlink rewires the PARENT checkout's node_modules and breaks it when the worktree is deleted. Run a real 'pnpm install' in the worktree instead (see AGENTS.md hard conventions)."
fi

# Rule 2 — pulling the trigger: a pnpm command that (re)links node_modules,
# run against a project whose node_modules is currently a symlink.
if printf '%s' "$cmd" | grep -qE '(^|[;|&([:space:]])pnpm[[:space:]]+(i|install|add|remove|rm|un|uninstall|update|up|upgrade|dedupe|prune|link|import|rebuild|dlx|patch-commit)([[:space:]]|$)'; then
  dir="$cwd"
  # Honor a `cd <path>` earlier in the same command line (common agent pattern:
  # `cd <worktree> && pnpm install`). Last cd wins; quotes are stripped naively —
  # this is a heuristic guard, and the cwd fallback covers the rest.
  cd_path=$(printf '%s' "$cmd" | grep -oE '(^|[;|&][[:space:]]*)cd[[:space:]]+[^;|&]+' | tail -1 | sed -E 's/^[;|&[:space:]]*cd[[:space:]]+//; s/[[:space:]]+$//; s/^["'"'"']//; s/["'"'"']$//') || true
  if [ -n "${cd_path:-}" ]; then
    case "$cd_path" in
      /*) dir="$cd_path" ;;
      *) dir="${cwd%/}/$cd_path" ;;
    esac
  fi
  # Nearest enclosing package.json = the project pnpm would operate on.
  d="$dir"
  while [ -n "$d" ] && [ "$d" != "/" ] && [ ! -f "$d/package.json" ]; do
    d=$(dirname "$d")
  done
  if [ -f "$d/package.json" ] && [ -L "$d/node_modules" ]; then
    block "Blocked: $d/node_modules is a symlink (points at $(readlink "$d/node_modules")). Running pnpm through it rewires the checkout that symlink points into. Remove the symlink and run a real 'pnpm install' here. If pnpm already ran through it once, repair the other checkout with 'CI=true pnpm install' there."
  fi
fi

exit 0
