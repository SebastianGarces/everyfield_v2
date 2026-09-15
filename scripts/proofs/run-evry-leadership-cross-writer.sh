#!/usr/bin/env bash
# Reproducible, disposable production-path proof. No shared database or model.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PG_MODULE:?Set PG_MODULE to pg/lib/index.js, as in the #830 handoff}"
test -f "$PG_MODULE"
task_scratch=$(mktemp -d "${TMPDIR:-/tmp}/evry-leadership-proof.XXXXXX")
task_pg="evry-leadership-proof-$(basename "$task_scratch" | tr '[:upper:]' '[:lower:]')"
cleanup() {
  docker rm -fv "$task_pg" >/dev/null 2>&1 || true
  rmdir "$task_scratch"
}
trap cleanup EXIT
docker run -d --name "$task_pg" \
  --mount type=tmpfs,destination=/var/lib/postgresql/data,tmpfs-size=2147483648 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=main \
  -p 127.0.0.1::5432 pgvector/pgvector:pg16 >/dev/null
task_ready=false
for _ in $(seq 1 60); do
  if docker exec "$task_pg" pg_isready -U postgres >/dev/null 2>&1; then
    task_ready=true
    break
  fi
  sleep 1
done
if [ "$task_ready" != true ]; then
  echo "Disposable PostgreSQL did not become ready" >&2
  exit 1
fi
PSQL="docker exec -i -e PGPASSWORD=postgres $task_pg psql -U postgres" \
  bash scripts/live-db-prepare.sh
docker exec "$task_pg" createdb -U postgres -T live_template proof825830
task_address=$(docker port "$task_pg" 5432/tcp)
DATABASE_URL="postgresql://postgres:postgres@$task_address/proof825830" \
  RESEND_API_KEY=re_ci_placeholder \
  node --no-warnings --experimental-test-module-mocks --import tsx \
    scripts/proofs/evry-leadership-cross-writer.mjs
