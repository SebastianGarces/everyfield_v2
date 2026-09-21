#!/usr/bin/env bash
set -euo pipefail
: "${PG_MODULE:?Set PG_MODULE to an installed pg driver entry file}"
proof_root="$(cd "$(dirname "$0")/../.." && pwd)"
proof_container="alpha-baseline-$(uuidgen | tr '[:upper:]' '[:lower:]')"
proof_owned_id=""
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "$proof_owned_id" ]]; then
    if ! docker rm -fv "$proof_owned_id" >/dev/null; then result=1; fi
    if docker container inspect "$proof_owned_id" >/dev/null 2>&1; then
      echo "ERROR: owned migration proof container remains" >&2
      result=1
    else
      echo "PASS: owned migration proof container removed"
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
proof_owned_id="$(docker run -d --name "$proof_container" --memory=256m --cpus=1 \
  -p 127.0.0.1::5432 \
  --mount type=tmpfs,destination=/var/lib/postgresql/data,tmpfs-size=268435456 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=alpha-local-proof \
  -e POSTGRES_DB=alpha_baseline_proof pgvector/pgvector:pg16)"
proof_ready=0
for ((attempt=0; attempt<45; attempt++)); do
  if docker exec -e PGPASSWORD=alpha-local-proof "$proof_owned_id" psql -h 127.0.0.1 -U postgres -d alpha_baseline_proof -Atqc 'select 1' >/dev/null 2>&1 \
    && docker logs "$proof_owned_id" 2>&1 | rg -q 'PostgreSQL init process complete'; then
    proof_ready=1
    break
  fi
  sleep 1
done
if [[ "$proof_ready" != 1 ]]; then docker logs "$proof_owned_id"; exit 1; fi
proof_address="$(docker port "$proof_owned_id" 5432)"
export ALPHA_MIGRATION_PG_URL="postgresql://postgres:alpha-local-proof@${proof_address}/alpha_baseline_proof"
export COREPACK_ENABLE_AUTO_PIN=0
cd "$proof_root"
node scripts/proofs/alpha-migration-baseline.mjs
