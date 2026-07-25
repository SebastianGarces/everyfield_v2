#!/usr/bin/env bash
#
# Resolve the Vercel preview URL for a branch or PR, so a feature branch can be
# exercised in a real browser.
#
# The problem this solves: localhost:3000 serves the main checkout, so a feature
# branch has nowhere to be seen. Every PR to main already gets a Vercel preview
# deployment; this finds its URL.
#
# Usage:
#   scripts/preview-url.sh                  # current branch
#   scripts/preview-url.sh feat/my-branch   # a branch
#   scripts/preview-url.sh 41               # a PR number
#   scripts/preview-url.sh --wait 41        # block until the deploy is ready
#   scripts/preview-url.sh --bypass 41      # append the protection-bypass params
#
# --bypass requires VERCEL_AUTOMATION_BYPASS_SECRET (see .env.example). Preview
# deployments sit behind Vercel Authentication; without it a browser lands on
# vercel.com/login instead of the app.
#
set -euo pipefail

wait_for_ready=false
with_bypass=false
target=""

while [ $# -gt 0 ]; do
  case "$1" in
    --wait) wait_for_ready=true ;;
    --bypass) with_bypass=true ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) target="$1" ;;
  esac
  shift
done

# Resolve the commit whose deployment we want.
if [ -z "$target" ]; then
  sha="$(git rev-parse HEAD)"
elif [[ "$target" =~ ^[0-9]+$ ]]; then
  sha="$(gh pr view "$target" --json headRefOid --jq .headRefOid)"
else
  # --verify --quiet, because a bare `git rev-parse` echoes an unresolvable ref
  # back on stdout instead of staying silent, which ends up concatenated into
  # $sha and produces a baffling error message downstream.
  sha="$(git rev-parse --verify --quiet "origin/$target" \
    || git rev-parse --verify --quiet "$target" \
    || true)"
  if [ -z "$sha" ]; then
    echo "Cannot resolve '$target' as a branch, ref, or PR number." >&2
    exit 2
  fi
fi

# Vercel creates one GitHub deployment per commit; its status carries the URL.
lookup() {
  local id
  id="$(gh api "repos/:owner/:repo/deployments?sha=$sha" \
    --jq '[.[] | select(.environment == "Preview")][0].id' 2>/dev/null)"
  if [ -z "$id" ] || [ "$id" = "null" ]; then
    return 1
  fi
  gh api "repos/:owner/:repo/deployments/$id/statuses" \
    --jq '[.[] | select(.state == "success")][0].environment_url // empty'
}

url="$(lookup || true)"

if [ -z "$url" ] && [ "$wait_for_ready" = true ]; then
  # Vercel builds this app in roughly 2 minutes; 10 is generous headroom.
  deadline=$(( $(date +%s) + 600 ))
  while [ -z "$url" ] && [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 15
    url="$(lookup || true)"
  done
fi

if [ -z "$url" ]; then
  echo "No successful preview deployment for ${sha:0:7}." >&2
  echo "It may still be building — retry with --wait, or check: gh pr checks" >&2
  exit 1
fi

if [ "$with_bypass" = true ]; then
  if [ -z "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]; then
    echo "VERCEL_AUTOMATION_BYPASS_SECRET is not set — see .env.example." >&2
    exit 1
  fi
  # x-vercel-set-bypass-cookie=true makes Vercel set a cookie on the redirect,
  # so every later navigation in the same browser session is already bypassed
  # and the secret does not have to ride along in each URL.
  echo "${url}?x-vercel-protection-bypass=${VERCEL_AUTOMATION_BYPASS_SECRET}&x-vercel-set-bypass-cookie=true"
else
  echo "$url"
fi
