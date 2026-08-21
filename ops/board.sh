#!/usr/bin/env bash
# The two board reads a pass makes, both safe to act on immediately (#579).
#
# Usage: ops/board.sh claims     # open issues someone is building — must be empty to start
#        ops/board.sh frontier   # open, unblocked, unassigned work this pass may take
#
# NEVER FILTER LABELS SERVER-SIDE. Measured 2026-08-21, immediately after
# `gh issue edit --add-label` returned:
#
#   07:20:07  server-filter=[]     client-filter=[501]
#   07:20:10  server-filter=[501]  client-filter=[501]
#
# About three seconds in which a label that IS set reads as unset. It is the
# FILTER that lags, not the endpoint or the CLI: `gh issue list --label`,
# `gh pr list --label` and `gh api ".../issues?labels=X"` all go through it and
# all lag together, while fetching the objects and matching `.labels[]` in jq
# sees the change on the next request.
#
# That is not a cosmetic delay for either read below. Both gate an action on a
# label another agent may have written seconds ago, and both failures are the
# same one: two passes on one issue.
#
#   - `claims` is the refusal that stops a second pass starting. Two passes
#     beginning within the lag window both read an empty claim list and both
#     proceed.
#   - `frontier` is what a pass picks work from. An issue claimed moments ago
#     still looks queued, so the pass takes work someone else is already on.
#
# The same lag bit the merge train (`ops/merge-hold.sh`), which is where the
# measurement came from.
set -euo pipefail

readonly REPO="${BOARD_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

# Every OPEN issue, whole. `--paginate` because the default page caps at 30 and
# says nothing about it; `select(.pull_request == null)` because this endpoint
# returns pull requests as issues too.
open_issues() {
  gh api --paginate "repos/${REPO}/issues?state=open&per_page=100" \
    --jq '.[] | select(.pull_request == null)'
}

case "${1:-}" in
  claims)
    open_issues | jq -r '
      select(any(.labels[]?; .name == "agent:in-progress"))
      | "#\(.number)\t\(.title)"'
    ;;

  frontier)
    # Unblocked and unassigned, in either takeable state. One pass over the
    # issues rather than one request per label, so an issue carrying both
    # labels is listed once instead of twice.
    open_issues | jq -r '
      select(any(.labels[]?; .name == "agent:queued" or .name == "agent:changes-requested"))
      | select(.issue_dependencies_summary.blocked_by == 0 and (.assignees | length) == 0)
      | .number'
    ;;

  *)
    echo "usage: ops/board.sh claims|frontier" >&2
    exit 2
    ;;
esac
