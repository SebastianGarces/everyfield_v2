#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# This check never uses credentials or calls a live model/database.
export DATABASE_URL=postgresql://ci:ci@localhost:5432/ci
export RESEND_API_KEY=re_ci_placeholder
pnpm exec tsx --test \
  src/lib/evry/capabilities/model-conversation.test.ts \
  src/lib/evry/capabilities/model-response.test.ts \
  src/lib/evry/capabilities/response-parts.test.ts \
  src/lib/evry/conversations/artifacts.test.ts \
  src/lib/evry/streaming/conversation-wire.test.ts \
  src/lib/evry/runs/conversation.test.ts \
  src/components/evry/artifacts/artifact-renderer.test.ts \
  src/components/evry/streaming/production-submit.test.ts \
  src/components/evry/client-contract.test.ts
pnpm exec tsc --noEmit --pretty false
