#!/usr/bin/env bash
# Codex SessionStart hook: regenerate and load the same engineering-principle
# context that CLAUDE.md imports for Claude Code.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
"$root/ops/principles-context.sh" >/dev/null
cat "$root/ops/principles.md"
