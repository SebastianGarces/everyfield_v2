#!/usr/bin/env bash
# Cursor adapter for the shared Claude/Cursor/Codex formatter hook.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$root/ops/format-agent-edit.sh"
