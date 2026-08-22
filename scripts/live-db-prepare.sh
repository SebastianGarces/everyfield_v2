#!/usr/bin/env bash
#
# =============================================================================
# BUILD THE DATABASES `pnpm test:live` RUNS AGAINST (#594).
#
# One database per live suite, so the fourteen parallel child processes stop
# sharing a write target. `scripts/live-db-names.ts` decides the names and
# carries the reasoning; this script only creates what that function names, so
# the two cannot drift into a suite pointed at a database nobody made.
#
# WHY A TEMPLATE. Applying 61 migrations fourteen times would be the obvious
# shape and the slow one. `CREATE DATABASE … TEMPLATE` is a file-level copy, so
# the migrations apply ONCE — to a template the neon proxy never connects to,
# which matters: Postgres refuses to copy a database that has another session
# on it, and the proxy holds a pooled connection to every database a suite
# names.
#
# WHY psql AND NOT `pnpm db:migrate`. drizzle-kit picks its driver from what is
# installed, the only installed driver is `@neondatabase/serverless`, and its
# websocket never reaches a plain TCP Postgres. The HTTP proxy is no road
# either — its prepared statements take one command each and the hand-written
# migrations are multi-command. So the versioned SQL applies directly, in
# journal order (the numeric prefixes), in autocommit because 0025 builds an
# index CONCURRENTLY.
#
# USAGE. Standard PG* environment variables locate the server. `PSQL` overrides
# the client invocation, which is the seam a machine with no local psql uses:
#
#   CI:     PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres ./scripts/live-db-prepare.sh
#   local:  PSQL="docker exec -i -e PGPASSWORD=postgres ef-pg psql -U postgres" ./scripts/live-db-prepare.sh
#
# Re-running is safe and is the intended way to reset: every suite database is
# dropped and re-copied from a freshly migrated template.
# =============================================================================

set -euo pipefail

TEMPLATE="${LIVE_DB_TEMPLATE:-live_template}"
PSQL="${PSQL:-psql}"

# The database named in the PROXY's own `PG_CONNECTION_STRING`, which is where
# it looks for its mock control plane — see the bootstrap step below. No suite
# runs against it any more; it is the proxy's doorway and nothing else.
PROXY_DATABASE="${LIVE_DB_PROXY_DATABASE:-main}"

# `psql -d <db>` for a single command, with failure fatal and chatter off.
run() {
  local database="$1"
  shift
  $PSQL -v ON_ERROR_STOP=1 -q -d "$database" "$@"
}

# The proxy authenticates through a MOCK control plane that reads two objects
# out of a database. Without them every query comes back as HTTP 500 "Control
# plane request failed" — which looks like a connection problem and is not.
#
# IT READS THEM FROM ITS OWN DATABASE, NOT THE REQUESTED ONE. `PG_CONNECTION_STRING`
# is where the proxy looks; the per-request `Neon-Connection-String` header only
# decides where the QUERY goes. Measured, after putting these objects in the
# template and watching all fourteen suites fail to connect at once: seeding
# every suite database and not this one buys nothing.
echo "==> bootstrapping the proxy's mock control plane in \`$PROXY_DATABASE\`"
run "$PROXY_DATABASE" <<'SQL'
CREATE SCHEMA IF NOT EXISTS neon_control_plane;
CREATE TABLE IF NOT EXISTS neon_control_plane.endpoints (
  endpoint_id VARCHAR(255) PRIMARY KEY,
  allowed_ips VARCHAR(255)
);
SQL

echo "==> (re)creating the template database \`$TEMPLATE\`"
# `WITH (FORCE)` so a stale session from an interrupted run cannot wedge this.
run postgres -c "DROP DATABASE IF EXISTS $TEMPLATE WITH (FORCE)"
run postgres -c "CREATE DATABASE $TEMPLATE"

# The guards under test are created HERE — a suite run against an unmigrated
# database would pass by proving nothing.
echo "==> applying migrations to \`$TEMPLATE\`"
# Fed on STDIN rather than with `-f`: under a containerised `PSQL` override the
# path would be read inside the container, where the repo is not mounted.
for migration in src/db/migrations/*.sql; do
  echo "    $migration"
  run "$TEMPLATE" <"$migration"
done

# ASSIGNED FIRST, THEN LOOPED, and that is not a style choice. A command
# substitution in a `for` word list does NOT trip `set -e`: if the names script
# failed, the loop body would simply never run, NO suite databases would be
# created, and this script would print "ready" and exit 0. A plain assignment
# does propagate the failure.
databases="$(pnpm exec tsx scripts/live-db-names.ts)"
[ -n "$databases" ] || {
  echo "scripts/live-db-names.ts named no databases" >&2
  exit 1
}

echo "==> copying it once per live suite"
for database in $databases; do
  echo "    $database"
  run postgres -c "DROP DATABASE IF EXISTS $database WITH (FORCE)"
  run postgres -c "CREATE DATABASE $database TEMPLATE $TEMPLATE"
done

echo "==> ready"
