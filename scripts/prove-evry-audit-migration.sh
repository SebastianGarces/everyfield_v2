#!/usr/bin/env bash
# Prove migration 0066 apply -> behavior -> rollback -> identical reapply.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PSQL="${PSQL:-psql}"
TARGET="src/db/migrations/0066_evry_audit.sql"
PROOF_DATABASE="${EVRY_AUDIT_PROOF_DATABASE:-evry_audit_migration_proof_$(date +%s)_$$}"

if [[ ! "$PROOF_DATABASE" =~ ^evry_audit_migration_proof_[a-z0-9_]{8,30}$ ]]; then
  echo "refusing unsafe proof database name: $PROOF_DATABASE" >&2
  exit 64
fi
if [ "$TARGET" != "src/db/migrations/0066_evry_audit.sql" ] ||
  [ ! -f "$TARGET" ]; then
  echo "refusing unexpected migration target: $TARGET" >&2
  exit 64
fi

run() {
  local database="$1"
  shift
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
    'evry_product_audit_events'::regclass,
    'evry_execution_attempts'::regclass,
    'evry_execution_outcomes'::regclass
  )
  UNION ALL
  SELECT 'index', indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename IN (
    'evry_product_audit_events',
    'evry_execution_attempts',
    'evry_execution_outcomes',
    'evry_plan_confirmations'
  ) AND indexname LIKE 'evry_%'
  UNION ALL
  SELECT 'trigger', tgname, pg_get_triggerdef(oid)
  FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN (
    'evry_action_plans_no_truncate',
    'evry_plan_confirmations_no_truncate',
    'evry_product_audit_events_immutable',
    'evry_product_audit_events_no_truncate',
    'evry_execution_attempts_immutable',
    'evry_execution_attempts_no_truncate',
    'evry_execution_outcomes_immutable',
    'evry_execution_outcomes_no_truncate',
    'evry_execution_outcomes_exact_step'
  )
  UNION ALL
  SELECT 'function', proname, pg_get_functiondef(oid)
  FROM pg_proc
  WHERE proname = 'evry_validate_execution_outcome_step'
  UNION ALL
  SELECT 'view', viewname, definition
  FROM pg_views
  WHERE schemaname = 'public' AND viewname = 'evry_redacted_telemetry'
) catalog;
SQL
}

echo "==> creating scratch database \`$PROOF_DATABASE\`"
cleanup
run postgres -v proof_database="$PROOF_DATABASE" <<'SQL'
SELECT format('CREATE DATABASE %I', :'proof_database') \gexec
SQL

echo "==> applying migrations before 0066"
for migration in src/db/migrations/*.sql; do
  [ "$migration" = "$TARGET" ] && break
  run "$PROOF_DATABASE" <"$migration"
done

echo "==> seeding a pre-0066 plan for deterministic backfill"
run "$PROOF_DATABASE" <<'SQL'
INSERT INTO churches (id, name)
VALUES ('10000000-0000-4000-8000-000000000001', '__evry audit proof__');
INSERT INTO users (id, email, password_hash, name, seat, church_id)
VALUES (
  '20000000-0000-4000-8000-000000000001', 'evry-audit@proof.invalid',
  'proof', '__evry audit proof__', 'owner',
  '10000000-0000-4000-8000-000000000001'
);
INSERT INTO evry_action_plans (
  id, church_id, actor_user_id, request_key, intent_fingerprint,
  fingerprint, document, created_at, expires_at
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  repeat('1', 64), repeat('a', 64), '{"version":1,"steps":[]}',
  '2026-08-28 12:00:00+00', '2026-08-28 12:15:00+00'
);
INSERT INTO evry_action_plan_states (plan_id, church_id, status, changed_at)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'awaiting_confirmation', '2026-08-28 12:00:00+00'
);
UPDATE evry_action_plan_states
SET status = 'approved', version = 1, changed_at = '2026-08-28 12:01:00+00'
WHERE plan_id = '30000000-0000-4000-8000-000000000001';
INSERT INTO evry_plan_confirmations (
  id, plan_id, church_id, actor_user_id, plan_fingerprint, decided_at
) VALUES (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', repeat('a', 64),
  '2026-08-28 12:01:00+00'
);
SQL

echo "==> applying 0066"
run "$PROOF_DATABASE" <"$TARGET"

surface="$(run "$PROOF_DATABASE" -At <<'SQL'
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
    'evry_product_audit_events', 'evry_execution_attempts', 'evry_execution_outcomes'
  )) || '|' ||
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'evry_%' AND (
    tgname LIKE '%_immutable' OR tgname LIKE '%_no_truncate'
  )) || '|' ||
  (to_regclass('public.evry_redacted_telemetry') IS NOT NULL)::int || '|' ||
  (SELECT count(*) FROM evry_product_audit_events WHERE event_type = 'plan_proposed') || '|' ||
  (SELECT count(*) FROM evry_product_audit_events WHERE event_type = 'plan_approved');
SQL
)"
[ "$surface" = "3|10|1|1|1" ] || {
  echo "unexpected table|trigger|view|backfill counts: $surface" >&2
  exit 1
}
echo "    table|trigger|view|backfill counts: $surface"

echo "==> proving closed request and exact execution tuples"
run "$PROOF_DATABASE" <<'SQL'
INSERT INTO evry_product_audit_events (
  church_id, actor_user_id, correlation_id, event_key,
  event_type, result_code, occurred_at
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002', repeat('2', 64),
  'request_refused', 'policy_refused', '2026-08-28 12:00:30+00'
);
INSERT INTO evry_execution_attempts (
  id, plan_id, church_id, actor_user_id, plan_fingerprint,
  confirmation_id, proposal_event_id, proposal_event_type,
  correlation_id, attempt_key, started_at
) VALUES (
  '50000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', repeat('a', 64),
  '40000000-0000-4000-8000-000000000001',
  (SELECT id FROM evry_product_audit_events
   WHERE plan_id = '30000000-0000-4000-8000-000000000001'
     AND event_type = 'plan_proposed'),
  'plan_proposed',
  '90000000-0000-4000-8000-000000000001', repeat('3', 64),
  '2026-08-28 12:02:00+00'
);
INSERT INTO evry_execution_outcomes (
  attempt_id, plan_id, church_id, actor_user_id, plan_fingerprint,
  correlation_id, outcome_key, effect_key, subject, status, result_code,
  affected_count, excluded_count, occurred_at
) VALUES (
  '50000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', repeat('a', 64),
  '90000000-0000-4000-8000-000000000001', repeat('4', 64), repeat('5', 64),
  'attempt', 'completed', 'noop_completed', 0, 0,
  '2026-08-28 12:02:01+00'
);
SQL

expect_refusal "request code mismatch" "evry_product_audit_events_shape_check" \
  "INSERT INTO evry_product_audit_events (church_id, actor_user_id, correlation_id, event_key, event_type, result_code, occurred_at) VALUES ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003', repeat('6',64), 'request_failed', 'read_completed', now());"
expect_refusal "partial plan tuple" "evry_product_audit_events_shape_check" \
  "INSERT INTO evry_product_audit_events (plan_id, church_id, actor_user_id, correlation_id, event_key, event_type, occurred_at) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003', repeat('7',64), 'plan_cancelled', now());"
expect_refusal "foreign attempt tuple" "evry_execution_attempts_exact_plan_fk" \
  "INSERT INTO evry_execution_attempts (plan_id, church_id, actor_user_id, plan_fingerprint, confirmation_id, proposal_event_id, correlation_id, attempt_key, started_at) VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000099', '20000000-0000-4000-8000-000000000001', repeat('a',64), '40000000-0000-4000-8000-000000000001', (SELECT id FROM evry_product_audit_events WHERE event_type = 'plan_proposed' LIMIT 1), '90000000-0000-4000-8000-000000000001', repeat('8',64), now());"
expect_refusal "unapproved step outcome" "exact approved plan step" \
  "INSERT INTO evry_execution_outcomes (attempt_id, plan_id, church_id, actor_user_id, plan_fingerprint, correlation_id, outcome_key, subject, step_id, capability_identity, status, result_code, occurred_at) VALUES ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', repeat('a',64), '90000000-0000-4000-8000-000000000001', repeat('9',64), 'step', 'not-approved', 'fixture:not-approved', 'failed', 'effect_failed', now());"

echo "==> proving append-only and redacted telemetry boundaries"
expect_refusal "audit event update" "immutable Evry row" \
  "UPDATE evry_product_audit_events SET occurred_at = now();"
expect_refusal "attempt delete" "immutable Evry row" \
  "DELETE FROM evry_execution_attempts;"
expect_refusal "outcome truncate" "immutable Evry row" \
  "TRUNCATE evry_execution_outcomes;"
expect_refusal "plan truncate" "immutable Evry row" \
  "TRUNCATE evry_action_plans CASCADE;"

telemetry_columns="$(run "$PROOF_DATABASE" -At <<'SQL'
SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'evry_redacted_telemetry';
SQL
)"
[ "$telemetry_columns" = "correlation_id,record_kind,event_name,capability_identity,status,result_code,affected_count,excluded_count,occurred_at" ] || {
  echo "unexpected telemetry columns: $telemetry_columns" >&2
  exit 1
}
[[ "$telemetry_columns" != *actor* && "$telemetry_columns" != *church* &&
  "$telemetry_columns" != *fingerprint* && "$telemetry_columns" != *plan_id* ]] || {
  echo "telemetry view leaked a scoped identity: $telemetry_columns" >&2
  exit 1
}
echo "    telemetry columns: $telemetry_columns"

before="$(catalog_signature)"
echo "    catalog signature after apply: $before"

echo "==> rolling 0066 back"
run "$PROOF_DATABASE" <<'SQL'
DROP VIEW "evry_redacted_telemetry";
DROP TRIGGER "evry_action_plans_no_truncate" ON "evry_action_plans";
DROP TRIGGER "evry_plan_confirmations_no_truncate" ON "evry_plan_confirmations";
DROP TABLE "evry_execution_outcomes";
DROP TABLE "evry_execution_attempts";
DROP TABLE "evry_product_audit_events";
DROP FUNCTION "evry_validate_execution_outcome_step"();
ALTER TABLE "evry_plan_confirmations"
  DROP CONSTRAINT "evry_plan_confirmations_church_id_churches_id_fk";
ALTER TABLE "evry_plan_confirmations"
  DROP CONSTRAINT "evry_plan_confirmations_actor_user_id_users_id_fk";
DROP INDEX "evry_plan_confirmations_exact_identity_unique_idx";
SQL

missing="$(run "$PROOF_DATABASE" -At <<'SQL'
SELECT
  (SELECT count(*) FROM unnest(ARRAY[
    'evry_product_audit_events', 'evry_execution_attempts',
    'evry_execution_outcomes', 'evry_redacted_telemetry'
  ]) name WHERE to_regclass('public.' || name) IS NULL) || '|' ||
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'evry_%_no_truncate') || '|' ||
  (to_regprocedure('evry_validate_execution_outcome_step()') IS NULL)::int;
SQL
)"
[ "$missing" = "4|0|1" ] || {
  echo "rollback left an Evry audit object behind: $missing" >&2
  exit 1
}
echo "    rollback removed all audit objects"

echo "==> reapplying 0066"
run "$PROOF_DATABASE" <"$TARGET"
after="$(catalog_signature)"
[ "$after" = "$before" ] || {
  echo "catalog changed across reapply: $before != $after" >&2
  exit 1
}
echo "    catalog signature after reapply: $after"
echo "==> Evry audit migration proof passed"
