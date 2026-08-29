#!/usr/bin/env bash
#
# =============================================================================
# THE LIVE LANE, ON A LAPTOP (#594).
#
# `pnpm test:live` needs the two things the `Live DB Race Suites` CI job stands
# up as service containers: a Postgres with pgvector (migration 0035 creates
# the `vector` extension, so a plain postgres image fails to migrate) and
# `local-neon-http-proxy` in front of it, because `@/db` is a neon-http client
# and cannot talk to Postgres over TCP.
#
# Until this script the only recipe for that lived inside the workflow file, so
# reproducing a live-suite failure locally meant reading YAML and translating
# it into docker commands. A flake nobody can reproduce is a flake nobody
# fixes, which is how #594 stayed open long enough to teach every track to
# re-run and move on.
#
#   ./scripts/live-db-stack.sh up      # containers + every per-suite database
#   ./scripts/live-db-stack.sh down    # remove both containers and the network
#
# `up` is re-runnable and is also the reset: it recreates the databases from a
# freshly migrated template.
# =============================================================================

set -euo pipefail

NETWORK="${LIVE_DB_NETWORK:-everyfield-live}"
PG_CONTAINER="${LIVE_DB_PG_CONTAINER:-everyfield-live-pg}"
PROXY_CONTAINER="${LIVE_DB_PROXY_CONTAINER:-everyfield-live-proxy}"

# Published on non-default ports so the stack cannot collide with a Postgres
# the developer already runs. Only the PROXY port reaches the test run —
# nothing connects to Postgres over TCP except this script.
PG_PORT="${LIVE_DB_PG_PORT:-55432}"
PROXY_PORT="${LIVE_DB_PROXY_PORT:-4444}"

usage() {
  echo "usage: $0 up|down" >&2
  exit 64
}

up() {
  docker network create "$NETWORK" >/dev/null 2>&1 || true
  # pgvector declares PGDATA as a VOLUME. Removing a prior container without
  # `-v` leaves that anonymous test database behind forever, so every reset
  # used to leak hundreds of megabytes. The live lane is intentionally
  # disposable: remove its anonymous mounts and keep the replacement in RAM.
  docker rm -fv "$PG_CONTAINER" "$PROXY_CONTAINER" >/dev/null 2>&1 || true

  echo "==> starting Postgres (pgvector) on :$PG_PORT"
  docker run -d --name "$PG_CONTAINER" --network "$NETWORK" \
    --mount type=tmpfs,destination=/var/lib/postgresql/data,tmpfs-size=2147483648 \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=main \
    -p "$PG_PORT:5432" \
    pgvector/pgvector:pg16 >/dev/null

  echo "==> starting the neon HTTP proxy on :$PROXY_PORT"
  # Service containers share a network and reach each other by name, hence the
  # container name rather than localhost in the proxy's own connection string.
  docker run -d --name "$PROXY_CONTAINER" --network "$NETWORK" \
    -e PG_CONNECTION_STRING="postgres://postgres:postgres@$PG_CONTAINER:5432/main" \
    -p "$PROXY_PORT:4444" \
    ghcr.io/timowilhelm/local-neon-http-proxy:main >/dev/null

  # Both waits END IN A FAILURE rather than falling through. A readiness loop
  # that runs out and carries on is worse than no wait: the next step dies on a
  # raw connection error that says nothing about what was actually not ready.
  wait_for() {
    local what="$1" attempts="$2"
    shift 2
    echo -n "==> waiting for $what"
    for _ in $(seq 1 "$attempts"); do
      if "$@" >/dev/null 2>&1; then
        echo " — ready"
        return 0
      fi
      echo -n "."
      sleep 1
    done
    echo " — GAVE UP after ${attempts}s"
    echo "$what never became ready; \`docker logs\` on the container will say why" >&2
    return 1
  }

  wait_for Postgres 60 docker exec "$PG_CONTAINER" pg_isready -U postgres

  # The proxy is what `pnpm test:live` talks to, so waiting only for Postgres
  # leaves the very next instruction racing container startup.
  #
  # No `-f`: a listening proxy answers 400 to this bodyless POST, and `-f` would
  # read that as failure and wait out the full minute. Bare `curl` exits 0 on
  # ANY HTTP response and non-zero when the connection is refused, which is
  # exactly the liveness question being asked.
  wait_for "the neon proxy" 60 \
    curl -s -o /dev/null --max-time 2 -X POST "http://localhost:$PROXY_PORT/sql"

  # No psql on the host is the common case, so the prepare script is handed a
  # containerised client through its `PSQL` seam. It is the same script CI
  # runs; only the way psql is invoked differs.
  PSQL="docker exec -i -e PGPASSWORD=postgres $PG_CONTAINER psql -U postgres" \
    ./scripts/live-db-prepare.sh

  cat <<EOF

==> run the suites with:

    LIVE_DB_TESTS=1 \\
    NEON_HTTP_PROXY_URL="http://localhost:$PROXY_PORT/sql" \\
    DATABASE_URL="postgresql://postgres:postgres@localhost:$PG_PORT/main" \\
    RESEND_API_KEY="re_ci_placeholder" \\
    pnpm test:live

Two things worth knowing before you read a result:

  · DATABASE_URL names the BASE connection only. The preload replaces its
    database component per suite, and the proxy takes the host from its own
    environment. \`main\` itself carries NO SCHEMA — the migrations go to the
    template and its copies — so anything else you point at that URL (the eval
    seed, a one-off script) reaches an empty database.

  · A FAILED run leaves fixtures behind, because a suite that throws does not
    finish its \`after()\` sweep. The next run then fails differently and more
    confusingly. Re-run ./scripts/live-db-prepare.sh to reset before believing
    a second red.
EOF
}

down() {
  docker rm -fv "$PG_CONTAINER" "$PROXY_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  echo "==> removed"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) usage ;;
esac
