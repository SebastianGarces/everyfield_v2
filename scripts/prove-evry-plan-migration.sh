#!/usr/bin/env bash
# Prove migration 0065 apply -> constraint behavior -> rollback -> identical reapply.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PSQL="${PSQL:-psql}"
TARGET="src/db/migrations/0065_evry_action_plans.sql"
PROOF_DATABASE="${EVRY_PLAN_PROOF_DATABASE:-evry_plan_migration_proof_$(date +%s)_$$}"

# The only destructive target this script accepts is a short, unmistakable
# scratch name. Validation happens before PSQL can run one byte.
if [[ ! "$PROOF_DATABASE" =~ ^evry_plan_migration_proof_[a-z0-9_]{8,30}$ ]]; then
  echo "refusing unsafe proof database name: $PROOF_DATABASE" >&2
  exit 64
fi
if [ "$TARGET" != "src/db/migrations/0065_evry_action_plans.sql" ] ||
  [ ! -f "$TARGET" ]; then
  echo "refusing unexpected migration target: $TARGET" >&2
  exit 64
fi

run() {
  local database="$1"
  shift
  # PSQL is intentionally a command seam, matching live-db-prepare.sh.
  # shellcheck disable=SC2086
  $PSQL -v ON_ERROR_STOP=1 -q -d "$database" "$@"
}

drop_proof_database() {
  run postgres -v proof_database="$PROOF_DATABASE" <<'SQL'
SELECT format('DROP DATABASE IF EXISTS %I WITH (FORCE)', :'proof_database') \gexec
SQL
}

cleanup() {
  drop_proof_database >/dev/null 2>&1 || true
}
trap cleanup EXIT

expect_refusal() {
  local label="$1" expected="$2" statement="$3" output
  if output="$(printf '%s\n' "$statement" | run "$PROOF_DATABASE" 2>&1)"; then
    echo "REFUSAL FAILED: $label" >&2
    exit 1
  fi
  if [[ "$output" != *"$expected"* ]]; then
    echo "WRONG REFUSAL for $label; expected $expected" >&2
    echo "$output" >&2
    exit 1
  fi
  echo "    refused: $label"
}

catalog_signature() {
  run "$PROOF_DATABASE" -At <<'SQL'
SELECT md5(string_agg(kind || ':' || name || ':' || definition, E'\n' ORDER BY kind, name))
FROM (
  SELECT 'constraint' AS kind, conname AS name, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE conrelid IN (
    'evry_action_plans'::regclass,
    'evry_action_plan_states'::regclass,
    'evry_plan_confirmations'::regclass
  )
  UNION ALL
  SELECT 'index', indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename IN (
    'evry_action_plans',
    'evry_action_plan_states',
    'evry_plan_confirmations'
  )
  UNION ALL
  SELECT 'trigger', tgname, pg_get_triggerdef(oid)
  FROM pg_trigger
  WHERE NOT tgisinternal AND tgrelid IN (
    'evry_action_plans'::regclass,
    'evry_plan_confirmations'::regclass
  )
  UNION ALL
  SELECT 'function', proname, pg_get_functiondef(oid)
  FROM pg_proc
  WHERE proname = 'evry_reject_immutable_row_mutation'
) catalog;
SQL
}

echo "==> creating scratch database \`$PROOF_DATABASE\`"
cleanup
run postgres -v proof_database="$PROOF_DATABASE" <<'SQL'
SELECT format('CREATE DATABASE %I', :'proof_database') \gexec
SQL

echo "==> applying migrations before 0065"
for migration in src/db/migrations/*.sql; do
  [ "$migration" = "$TARGET" ] && break
  run "$PROOF_DATABASE" <"$migration"
done

echo "==> applying 0065"
run "$PROOF_DATABASE" <"$TARGET"

surface="$(run "$PROOF_DATABASE" -At <<'SQL'
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'evry%plan%') || '|' ||
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('evry_action_plans', 'evry_action_plan_states', 'evry_plan_confirmations')) || '|' ||
  (SELECT count(*) FROM pg_constraint WHERE conrelid IN ('evry_action_plans'::regclass, 'evry_action_plan_states'::regclass, 'evry_plan_confirmations'::regclass)) || '|' ||
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('evry_action_plans'::regclass, 'evry_plan_confirmations'::regclass)) || '|' ||
  (SELECT count(*) FROM pg_proc WHERE proname = 'evry_reject_immutable_row_mutation');
SQL
)"
[ "$surface" = "3|11|16|2|1" ] || {
  echo "unexpected table|index|constraint|trigger|function counts: $surface" >&2
  exit 1
}
echo "    table|index|constraint|trigger|function counts: $surface"

echo "==> proving exact tuple and lifecycle constraints"
run "$PROOF_DATABASE" <<'SQL'
INSERT INTO churches (id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', '__evry migration proof__'),
  ('10000000-0000-4000-8000-000000000002', '__evry migration proof__');
INSERT INTO users (id, email, password_hash, name, seat, church_id) VALUES
  ('20000000-0000-4000-8000-000000000001', 'evry-one@proof.invalid', 'proof', '__evry migration proof__', 'owner', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'evry-two@proof.invalid', 'proof', '__evry migration proof__', 'owner', '10000000-0000-4000-8000-000000000002');
INSERT INTO evry_action_plans (id, church_id, actor_user_id, request_key, intent_fingerprint, fingerprint, document, created_at, expires_at) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', repeat('1', 64), repeat('a', 64), '{"version":1,"steps":[]}', '2026-08-28 12:00:00+00', '2026-08-28 12:15:00+00'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', repeat('2', 64), repeat('b', 64), '{"version":1,"steps":[]}', '2026-08-28 12:00:00+00', '2026-08-28 12:15:00+00'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003', repeat('3', 64), repeat('c', 64), '{"version":1,"steps":[]}', '2026-08-28 12:00:00+00', '2026-08-28 12:15:00+00'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000004', repeat('4', 64), repeat('d', 64), '{"version":1,"steps":[]}', '2026-08-28 12:00:00+00', '2026-08-28 12:15:00+00'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000005', repeat('5', 64), repeat('5', 64), '{"version":1,"reviewed":"original"}', '2026-08-28 12:00:00+00', '2026-08-28 12:15:00+00');
INSERT INTO evry_action_plan_states (plan_id, church_id, status, changed_at)
VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'approved', '2026-08-28 12:01:00+00'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'awaiting_confirmation', '2026-08-28 12:00:00+00');
INSERT INTO evry_plan_confirmations (plan_id, church_id, actor_user_id, plan_fingerprint, decided_at)
VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', repeat('a', 64), '2026-08-28 12:01:00+00');
SQL

expect_refusal "different actor" "evry_plan_confirmations_exact_plan_fk" \
  "INSERT INTO evry_plan_confirmations (plan_id, church_id, actor_user_id, plan_fingerprint, decided_at) VALUES ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', repeat('b',64), now());"
expect_refusal "different fingerprint" "evry_plan_confirmations_exact_plan_fk" \
  "INSERT INTO evry_plan_confirmations (plan_id, church_id, actor_user_id, plan_fingerprint, decided_at) VALUES ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', repeat('e',64), now());"
expect_refusal "different plant" "evry_plan_confirmations_exact_plan_fk" \
  "INSERT INTO evry_plan_confirmations (plan_id, church_id, actor_user_id, plan_fingerprint, decided_at) VALUES ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', repeat('d',64), now());"
expect_refusal "duplicate confirmation" "evry_plan_confirmations_plan_unique_idx" \
  "INSERT INTO evry_plan_confirmations (plan_id, church_id, actor_user_id, plan_fingerprint, decided_at) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', repeat('a',64), now());"
expect_refusal "cross-plant successor" "evry_action_plans_supersedes_fk" \
  "INSERT INTO evry_action_plans (church_id, actor_user_id, request_key, intent_fingerprint, fingerprint, document, created_at, expires_at, supersedes_plan_id) VALUES ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000006', repeat('6',64), repeat('f',64), '{}', now(), now() + interval '15 minutes', '30000000-0000-4000-8000-000000000001');"
expect_refusal "invalid lifecycle status" "evry_action_plan_states_status_check" \
  "INSERT INTO evry_action_plan_states (plan_id, church_id, status, changed_at) VALUES ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'confirmed', now());"
expect_refusal "+1ms forged expiration" "evry_action_plans_expiration_check" \
  "INSERT INTO evry_action_plans (church_id, actor_user_id, request_key, intent_fingerprint, fingerprint, document, created_at, expires_at) VALUES ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000007', repeat('7',64), repeat('0',64), '{}', '2026-08-28 12:00:00+00', '2026-08-28 12:15:00.001+00');"

echo "==> proving append-only rows and the integrity-read gap"
expect_refusal "plan update" "immutable Evry row" \
  "UPDATE evry_action_plans SET document = '{\"tampered\":true}' WHERE id = '30000000-0000-4000-8000-000000000002';"
expect_refusal "plan delete" "immutable Evry row" \
  "DELETE FROM evry_action_plans WHERE id = '30000000-0000-4000-8000-000000000002';"
expect_refusal "confirmation update" "immutable Evry row" \
  "UPDATE evry_plan_confirmations SET decided_at = now() WHERE plan_id = '30000000-0000-4000-8000-000000000001';"
expect_refusal "confirmation delete" "immutable Evry row" \
  "DELETE FROM evry_plan_confirmations WHERE plan_id = '30000000-0000-4000-8000-000000000001';"

reviewed="$(run "$PROOF_DATABASE" -At -c "SELECT fingerprint || '|' || (document->>'reviewed') FROM evry_action_plans WHERE id = '30000000-0000-4000-8000-000000000005'")"
[ "$reviewed" = "$(printf '5%.0s' {1..64})|original" ] || {
  echo "integrity read did not return the reviewed plan" >&2
  exit 1
}
expect_refusal "tamper after integrity read" "immutable Evry row" \
  "UPDATE evry_action_plans SET document = '{\"version\":1,\"reviewed\":\"tampered\"}' WHERE id = '30000000-0000-4000-8000-000000000005';"
run "$PROOF_DATABASE" <<'SQL'
WITH transitioned AS (
  UPDATE evry_action_plan_states s
  SET status = 'approved', version = version + 1, changed_at = '2026-08-28 12:01:00+00'
  FROM evry_action_plans p
  WHERE s.plan_id = p.id
    AND p.id = '30000000-0000-4000-8000-000000000005'
    AND p.church_id = '10000000-0000-4000-8000-000000000001'
    AND p.actor_user_id = '20000000-0000-4000-8000-000000000001'
    AND p.fingerprint = repeat('5', 64)
    AND s.status = 'awaiting_confirmation'
  RETURNING p.id, p.church_id, p.actor_user_id, p.fingerprint
)
INSERT INTO evry_plan_confirmations (plan_id, church_id, actor_user_id, plan_fingerprint, decided_at)
SELECT id, church_id, actor_user_id, fingerprint, '2026-08-28 12:01:00+00'
FROM transitioned;
SQL
confirmed="$(run "$PROOF_DATABASE" -At -c "SELECT s.status || '|' || (p.document->>'reviewed') || '|' || count(c.id) FROM evry_action_plans p JOIN evry_action_plan_states s ON s.plan_id = p.id LEFT JOIN evry_plan_confirmations c ON c.plan_id = p.id WHERE p.id = '30000000-0000-4000-8000-000000000005' GROUP BY s.status, p.document")"
[ "$confirmed" = "approved|original|1" ] || {
  echo "tamper-gap confirmation proof failed: $confirmed" >&2
  exit 1
}
echo "    integrity-read gap retained original bytes and confirmed once"

before="$(catalog_signature)"
echo "    catalog signature after apply: $before"

echo "==> rolling 0065 back"
run "$PROOF_DATABASE" <<'SQL'
DROP TABLE "evry_plan_confirmations";
DROP TABLE "evry_action_plan_states";
DROP TABLE "evry_action_plans";
DROP FUNCTION "evry_reject_immutable_row_mutation"();
SQL
missing="$(run "$PROOF_DATABASE" -At <<'SQL'
SELECT
  (SELECT count(*) FROM unnest(ARRAY[
    'evry_action_plans', 'evry_action_plan_states', 'evry_plan_confirmations'
  ]) name WHERE to_regclass('public.' || name) IS NULL) || '|' ||
  (to_regprocedure('evry_reject_immutable_row_mutation()') IS NULL)::int;
SQL
)"
[ "$missing" = "3|1" ] || {
  echo "rollback left an Evry plan object behind: $missing" >&2
  exit 1
}
echo "    rollback removed all 3 tables and trigger function"

echo "==> reapplying 0065"
run "$PROOF_DATABASE" <"$TARGET"
after="$(catalog_signature)"
[ "$after" = "$before" ] || {
  echo "catalog changed across reapply: $before != $after" >&2
  exit 1
}
echo "    catalog signature after reapply: $after"
echo "==> Evry plan migration proof passed"
