#!/usr/bin/env bash
# Cursor beforeShellExecution adapter for ops/guard-worktree-pnpm.sh.
# Reads Cursor's hook JSON on stdin, emits {"permission": "allow"|"deny"}.
# Both camelCase and snake_case message keys are emitted; Cursor ignores extras.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.command // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
root="$(cd "$(dirname "$0")/../.." && pwd)"

if out=$("$root/ops/guard-worktree-pnpm.sh" "$cwd" "$cmd" 2>/dev/null); then
  printf '{"permission":"allow"}\n'
else
  jq -cn --arg m "$out" \
    '{permission: "deny", userMessage: $m, agentMessage: $m, user_message: $m, agent_message: $m}'
fi
