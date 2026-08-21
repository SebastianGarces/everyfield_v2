#!/usr/bin/env bash
# Is anything holding the merge train right now? (#579)
#
# Usage: ops/merge-hold.sh <your-pr-number> [--wait]
#
#   exit 0  nothing holds you — merge
#   exit 1  a `merge-priority` PR is open and it is not yours; it names them
#
# CALL IT IN THE SAME BREATH AS THE MERGE, never at the top of the ship step:
#
#   ops/merge-hold.sh 578 && gh pr merge 578 --squash
#
# WHAT THIS EXISTS FOR. On 2026-08-21 the orchestrator froze the merge train by
# messaging each track. #578 merged at 10:10:09Z and the hold arrived seconds
# later, knocking starved PR #571 to BEHIND for the sixth time. The track had
# checked its instructions minutes earlier and was correct to merge on what it
# knew. A hold delivered to an inbox races the merge and loses; a hold read out
# of the board at the moment of merging cannot.
#
# So the window this closes is the gap between deciding to merge and merging.
# A check at the start of the ship step reopens exactly that gap — CI takes
# minutes, and the hold lands inside them.
#
# ARMING AUTO-MERGE IS MERGING. `--auto` merges later, on its own, without
# re-reading anything. Never arm it while this exits 1: poll with --wait, then
# merge for real.
#
# A STALE LABEL HOLDS NOBODY, by construction rather than by tidiness: only
# OPEN pull requests are considered, so a `merge-priority` label left on a
# merged PR is already inert and nobody has to remember to strip it.
set -euo pipefail

readonly LABEL="merge-priority"

# How long --wait keeps polling before giving up loudly. A hold that never
# clears must fail the track, not hang it until the session dies.
readonly TIMEOUT_S="${MERGE_HOLD_TIMEOUT_S:-2700}"
readonly POLL_S=30

mine="${1:-}"
if [ -z "$mine" ]; then
  echo "usage: ops/merge-hold.sh <your-pr-number> [--wait]" >&2
  exit 2
fi

# The holders that are not you, as "#<n> <title>" lines. Empty means clear.
#
# READ THE PULLS ENDPOINT, NOT `gh pr list --label`. That flag queries the
# SEARCH index, which lags: measured 2026-08-21, a label was invisible to
# search for ~3s after `gh pr edit --add-label` returned, while this endpoint
# had it on the next request. Three seconds is the same order as the race this
# script exists to close, so a hold applied moments ago must not read as clear.
# `--paginate` because the default page caps and says nothing about it.
holders() {
  gh api --paginate "repos/{owner}/{repo}/pulls?state=open&per_page=100" \
    --jq ".[] | select(any(.labels[]?; .name == \"${LABEL}\")) | select(.number != ${mine}) | \"#\(.number) \(.title)\""
}

report() {
  echo "HELD — $LABEL is on an open PR that is not #${mine}:"
  printf '%s\n' "$1" | sed 's/^/  /'
}

if [ "${2:-}" != "--wait" ]; then
  held=$(holders)
  if [ -z "$held" ]; then
    echo "clear — nothing holds #${mine}"
    exit 0
  fi
  report "$held"
  echo "Wait for it to merge, then merge. Re-run with --wait to block until it does."
  exit 1
fi

deadline=$(( $(date +%s) + TIMEOUT_S ))
while :; do
  held=$(holders)
  if [ -z "$held" ]; then
    echo "clear — nothing holds #${mine}"
    exit 0
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    report "$held"
    echo "Still held after ${TIMEOUT_S}s. Not merging — tell the orchestrator."
    exit 1
  fi

  report "$held"
  echo "waiting ${POLL_S}s…"
  sleep "$POLL_S"
done
