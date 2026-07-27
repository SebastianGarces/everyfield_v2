#!/usr/bin/env bash
#
# worktree-env.sh — give a git worktree the env it needs to run `pnpm test`.
#
# The problem this solves: `git worktree add` materialises tracked files only, and
# `.env.local` is gitignored — so a worktree created for a track has no
# DATABASE_URL. `pnpm test` runs `tsx --env-file-if-exists=.env.local`, which
# silently finds nothing, and every DB-touching suite fails for a reason that has
# nothing to do with the change under test. This is THE one place that says how a
# worktree gets its test env; prompts and skills reference this script rather than
# restating it, so there is a single thing to fix when it changes.
#
# What it does: symlinks the main checkout's `.env.local` into the worktree.
#   - A symlink, not a copy: no second copy of the secrets on disk, and the
#     worktree can never drift from the checkout the human maintains.
#   - `.env.local` is gitignored (the script refuses to link it if it is not), so
#     `git status` in the worktree stays clean and the file cannot be committed.
#   - The link dies with `git worktree remove`; the main checkout's file is untouched.
#
# Usage:
#   scripts/worktree-env.sh                    # link into the worktree you are in
#   scripts/worktree-env.sh <worktree-dir>     # link into that worktree
#   scripts/worktree-env.sh --check [<dir>]    # report only; exit 1 if env is missing
#
# Deps are a separate problem: a fresh worktree also has no `node_modules`, so run
# `pnpm install` there too.
#
# CI is untouched by this: it has no `.env.local` and gets its env from repository
# secrets. Never run it in CI, and never commit anything it creates.
#
set -euo pipefail

# Only `.env.local` — that is the file `pnpm test` and `drizzle.config.ts` read.
ENV_FILES=(.env.local)

check_only=false
target=""

while [ $# -gt 0 ]; do
  case "$1" in
    --check) check_only=true ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "worktree-env: unknown flag: $1" >&2; exit 2 ;;
    *) target="$1" ;;
  esac
  shift
done

target="${target:-$PWD}"

if [ ! -d "$target" ]; then
  echo "worktree-env: no such directory: $target" >&2
  exit 2
fi

# Resolve both roots from git itself, so this works from any cwd and makes no
# assumption about where the script or the worktree live.
if ! wt_root="$(git -C "$target" rev-parse --show-toplevel 2>/dev/null)"; then
  echo "worktree-env: $target is not inside a git worktree" >&2
  exit 2
fi

# The common dir is the MAIN checkout's `.git`, whichever worktree you ask from.
common_dir="$(git -C "$target" rev-parse --path-format=absolute --git-common-dir)"
main_root="$(dirname "$common_dir")"

if [ "$wt_root" = "$main_root" ]; then
  echo "worktree-env: $wt_root is the main checkout — nothing to link."
  exit 0
fi

status=0

for f in "${ENV_FILES[@]}"; do
  src="$main_root/$f"
  dst="$wt_root/$f"

  if [ -e "$dst" ] || [ -L "$dst" ]; then
    echo "worktree-env: $f already present in $wt_root — left as is."
    continue
  fi

  if [ ! -f "$src" ]; then
    {
      echo "worktree-env: no $f in the main checkout ($main_root)."
      echo "  Without it, DB-touching suites fail on a missing DATABASE_URL."
      echo "  Create it there first (cp .env.example .env.local and fill DATABASE_URL,"
      echo "  or vercel env pull .env.local), then re-run: scripts/worktree-env.sh $wt_root"
    } >&2
    status=1
    continue
  fi

  # Refuse to place a file the worktree would offer up for commit. If someone
  # ever loosens .gitignore, this fails loudly instead of leaking credentials.
  if ! git -C "$wt_root" check-ignore -q "$f"; then
    echo "worktree-env: refusing to link $f — it is NOT gitignored in $wt_root." >&2
    status=1
    continue
  fi

  if $check_only; then
    echo "worktree-env: $f missing in $wt_root (would link → $src)"
    status=1
    continue
  fi

  ln -s "$src" "$dst"
  echo "worktree-env: linked $f → $src"
done

exit "$status"
