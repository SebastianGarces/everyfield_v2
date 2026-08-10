#!/usr/bin/env bash
# Sweep browser processes left behind by the playwright / chrome-devtools MCP servers.
#
# Verifier agents are required to close their own browsers (validate-frontend /
# browser-validation teardown rule); this sweep catches the ones whose agent died
# before teardown. Left running, they accumulate across a long dispatch pass and
# exhaust RAM (froze the host on 2026-08-09).
#
# Safe by construction: the patterns match only MCP-owned browser binaries/profiles —
#   - Playwright browsers run from Library/Caches/ms-playwright
#   - chrome-devtools-mcp launches Chrome with a user-data-dir under chrome-devtools-mcp
# They never match the user's own Chrome and never match the MCP server processes
# themselves (killing a live stdio server would break the session's tools).
#
# Run at a PASS BOUNDARY ONLY — a verifier in flight loses its browser mid-assert.
set -uo pipefail

swept=0
for pat in "Library/Caches/ms-playwright" "chrome-devtools-mcp/chrome-profile" "user-data-dir=[^ ]*chrome-devtools-mcp"; do
  while IFS= read -r pid; do
    if [ -n "$pid" ] && kill "$pid" 2>/dev/null; then
      swept=$((swept + 1))
    fi
  done < <(pgrep -f "$pat" || true)
done

echo "swept ${swept} MCP browser process(es)"
