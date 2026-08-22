#!/usr/bin/env bash
#
# =============================================================================
# 0064 APPLIES AND ROLLS BACK — RERUNNABLE (#617, CS-004).
#
# The issue's validation plan asks for the avatar column's migration to be
# proven both ways, and "I read the DDL and it looked additive" is not that. So
# this runs it, against the real Postgres `./scripts/live-db-stack.sh up` stands
# up, and prints the catalog's own answer at each step.
#
# It reads the DDL out of the migration file rather than restating it, so a
# migration that is edited and a proof that is not cannot drift apart.
#
# The subject is a THROWAWAY database created and dropped by this script — never
# `live_template` (the suites copy it) and never anybody's dev database. Idempotent:
# it drops the scratch database first, so a crashed earlier run costs nothing.
#
#   ./scripts/live-db-stack.sh up          # once, if the stack is not running
#   ./scripts/prove-avatar-column.sh
# =============================================================================

set -euo pipefail

PG_CONTAINER="${LIVE_DB_PG_CONTAINER:-everyfield-live-pg}"
SCRATCH="${AVATAR_PROOF_DB:-avatar_column_proof}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT/src/db/migrations/0064_user_avatar_key.sql"

psql_run() {
  docker exec -i "$PG_CONTAINER" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -t -A "${@:2}"
}

# The catalog's answer, not ours: name, type and nullability, or nothing at all.
column_state() {
  psql_run "$SCRATCH" -c "
    select column_name || ' ' || data_type || '(' || character_maximum_length || ') nullable=' || is_nullable
    from information_schema.columns
    where table_name = 'users' and column_name = 'avatar_key'"
}

# The forward DDL, taken FROM the migration — comments and blank lines dropped.
APPLY_SQL="$(grep -v '^--' "$MIGRATION" | grep -v '^[[:space:]]*$')"

# The rollback the migration's header promises, asserted to be there so the
# header cannot promise one spelling while this proves another.
grep -q 'DROP COLUMN "avatar_key"' "$MIGRATION" ||
  { echo "FAIL: 0064's header does not name the rollback this script proves"; exit 1; }
ROLLBACK_SQL='ALTER TABLE "users" DROP COLUMN "avatar_key";'

echo "==> scratch database \`$SCRATCH\` (users table only — 0064 touches nothing else)"
psql_run postgres -c "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)" >/dev/null
psql_run postgres -c "CREATE DATABASE $SCRATCH" >/dev/null
psql_run "$SCRATCH" -c 'CREATE TABLE "users" (id uuid primary key, email varchar(255) not null)' >/dev/null
psql_run "$SCRATCH" -c "INSERT INTO users VALUES (gen_random_uuid(), 'planter@example.test')" >/dev/null

echo "==> before:   [$(column_state)]"
[ -z "$(column_state)" ] || { echo "FAIL: the column exists before the migration"; exit 1; }

echo "==> applying 0064"
psql_run "$SCRATCH" -c "$APPLY_SQL" >/dev/null
AFTER="$(column_state)"
echo "==> after:    [$AFTER]"
[ "$AFTER" = "avatar_key character varying(500) nullable=YES" ] ||
  { echo "FAIL: unexpected column state after apply"; exit 1; }

# The row that existed before the column did must have survived it, holding
# NULL — "no picture", the value the initials fallback renders for.
NULLS="$(psql_run "$SCRATCH" -c 'select count(*) from users where avatar_key is null')"
ROWS="$(psql_run "$SCRATCH" -c 'select count(*) from users')"
echo "==> existing rows: $ROWS, of which NULL avatar_key: $NULLS"
[ "$NULLS" = "$ROWS" ] && [ "$ROWS" = "1" ] ||
  { echo "FAIL: the pre-existing row did not survive as NULL"; exit 1; }

echo "==> rolling back"
psql_run "$SCRATCH" -c "$ROLLBACK_SQL" >/dev/null
echo "==> rolled back: [$(column_state)]"
[ -z "$(column_state)" ] || { echo "FAIL: the column outlived its rollback"; exit 1; }

# ROLLBACK IS NOT A ONE-WAY DOOR: re-applying after it must land the same
# column, which is what makes an operator's undo recoverable rather than final.
psql_run "$SCRATCH" -c "$APPLY_SQL" >/dev/null
[ "$(column_state)" = "$AFTER" ] ||
  { echo "FAIL: re-applying after a rollback did not restore the column"; exit 1; }
echo "==> re-applied after rollback: [$(column_state)]"

psql_run postgres -c "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)" >/dev/null
echo
echo "PASS — 0064 applies, preserves existing rows as NULL, rolls back, and re-applies."
