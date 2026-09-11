#!/usr/bin/env bash
set -euo pipefail
# Install pg@8.16.3 outside the repo and set PG_MODULE to its lib/index.js.
: "${PG_MODULE:?Set PG_MODULE to an installed pg driver entry file}"
proof_root="$(cd "$(dirname "$0")/../.." && pwd)"
proof_container="ef830-native-races-$$"
cleanup() { docker rm -fv "$proof_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Fail on a name collision rather than adopting somebody else's container.
if docker container inspect "$proof_container" >/dev/null 2>&1; then
  echo 'Refusing an existing container' >&2
  trap - EXIT
  exit 1
fi
docker run -d --name "$proof_container" --memory=256m --cpus=1 \
  -p 127.0.0.1::5432 \
  --mount type=tmpfs,destination=/var/lib/postgresql/data,tmpfs-size=268435456 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=proof830-local-only \
  -e POSTGRES_DB=proof830 pgvector/pgvector:pg16 >/dev/null
proof_ready=0
for ((attempt=0; attempt<30; attempt++)); do
  if docker exec "$proof_container" pg_isready -h 127.0.0.1 -U postgres -d proof830 >/dev/null 2>&1 \
    && docker logs "$proof_container" 2>&1 | rg -q 'PostgreSQL init process complete'; then
    proof_ready=1
    break
  fi
  sleep 1
done
if [[ "$proof_ready" != 1 ]]; then
  docker logs "$proof_container"
  exit 1
fi
proof_address="$(docker port "$proof_container" 5432)"
export PROVENANCE_PG_URL="postgresql://postgres:proof830-local-only@${proof_address}/proof830"
cd "$proof_root"
node --no-warnings --experimental-test-module-mocks --import tsx \
  "${PROVENANCE_PROOF_SCRIPT:-scripts/proofs/team-leader-provenance-races-830.mjs}"
