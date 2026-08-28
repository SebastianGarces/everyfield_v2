#!/usr/bin/env bash
# Prove migration 0068 apply -> behavior -> rollback -> identical reapply.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PSQL="${PSQL:-psql}"
TARGET="src/db/migrations/0068_evry_conversations.sql"
PROOF_DATABASE="${EVRY_CONVERSATION_PROOF_DATABASE:-evry_conversation_migration_proof_$(date +%s)_$$}"

if [[ ! "$PROOF_DATABASE" =~ ^evry_conversation_migration_proof_[a-z0-9_]{8,30}$ ]]; then
  echo "refusing unsafe proof database name: $PROOF_DATABASE" >&2
  exit 64
fi
if [ "$TARGET" != "src/db/migrations/0068_evry_conversations.sql" ] ||
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
  SELECT 'column' AS kind, table_name || '.' || column_name AS name,
    data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS definition
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name LIKE 'evry_conversation%'
  UNION ALL
  SELECT 'constraint', conname, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid IN (
    'evry_conversations'::regclass,
    'evry_conversation_states'::regclass,
    'evry_conversation_messages'::regclass,
    'evry_conversation_artifacts'::regclass
  )
  UNION ALL
  SELECT 'index', indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename IN (
    'evry_conversations', 'evry_conversation_states',
    'evry_conversation_messages', 'evry_conversation_artifacts'
  )
) catalog;
SQL
}

echo "==> creating scratch database \`$PROOF_DATABASE\`"
cleanup
run postgres -v proof_database="$PROOF_DATABASE" <<'SQL'
SELECT format('CREATE DATABASE %I', :'proof_database') \gexec
SQL

echo "==> applying migrations before 0068"
for migration in src/db/migrations/*.sql; do
  [ "$migration" = "$TARGET" ] && break
  run "$PROOF_DATABASE" <"$migration"
done

echo "==> seeding exact actor, plant, and plan prerequisite"
run "$PROOF_DATABASE" <<'SQL'
INSERT INTO churches (id, name)
VALUES ('10000000-0000-4000-8000-000000000001', '__evry conversation proof__');
INSERT INTO users (id, email, password_hash, name, seat, church_id)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'conversation@proof.invalid',
   'proof', 'Conversation actor', 'owner',
   '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'other-conversation@proof.invalid',
   'proof', 'Other actor', 'admin',
   '10000000-0000-4000-8000-000000000001');
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
SQL

echo "==> applying 0068"
run "$PROOF_DATABASE" <"$TARGET"

surface="$(run "$PROOF_DATABASE" -At <<'SQL'
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
    'evry_conversations', 'evry_conversation_states',
    'evry_conversation_messages', 'evry_conversation_artifacts'
  )) || '|' ||
  (SELECT count(*) FROM pg_constraint WHERE conrelid IN (
    'evry_conversations'::regclass, 'evry_conversation_states'::regclass,
    'evry_conversation_messages'::regclass,
    'evry_conversation_artifacts'::regclass
  ) AND contype = 'f') || '|' ||
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (
    'evry_conversations', 'evry_conversation_states',
    'evry_conversation_messages', 'evry_conversation_artifacts'
  ));
SQL
)"
[ "$surface" = "4|6|12" ] || {
  echo "unexpected table|foreign-key|index counts: $surface" >&2
  exit 1
}
echo "    table|foreign-key|index counts: $surface"

echo "==> proving exact aggregate and typed artifact shape"
run "$PROOF_DATABASE" <<'SQL'
INSERT INTO evry_conversations (
  id, church_id, actor_user_id, title, next_message_sequence,
  active_plan_id, active_plan_fingerprint, created_at, last_activity_at
) VALUES (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Create the follow-up', 1,
  '30000000-0000-4000-8000-000000000001', repeat('a', 64),
  '2026-08-28 12:01:00+00', '2026-08-28 12:01:00+00'
);
INSERT INTO evry_conversation_states (
  conversation_id, church_id, actor_user_id, version, document, changed_at
) VALUES (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 0,
  '{"version":1,"resolvedReferences":[],"explicitChoices":[],"activeRecipe":null,"pendingClarification":null,"completedSteps":[],"summary":null}',
  '2026-08-28 12:01:00+00'
);
INSERT INTO evry_conversation_messages (
  id, conversation_id, church_id, actor_user_id, request_key,
  body_fingerprint, request_fingerprint, sequence, author, body, page_context,
  relevance_keys, delivery_status, created_at
) VALUES (
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002', repeat('b', 64), repeat('e', 64), 0,
  'assistant', 'Review the plan.', null, '[]', 'complete',
  '2026-08-28 12:01:00+00'
);
INSERT INTO evry_conversation_artifacts (
  id, message_id, conversation_id, church_id, actor_user_id,
  ordinal, kind, document, created_at
) VALUES (
  '60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 0,
  'confirmation', '{"kind":"confirmation"}',
  '2026-08-28 12:01:00+00'
);
SQL

expect_refusal "foreign active-plan actor" "evry_conversations_active_plan_fk" \
  "INSERT INTO evry_conversations (church_id, actor_user_id, title, active_plan_id, active_plan_fingerprint, created_at, last_activity_at) VALUES ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Forged plan', '30000000-0000-4000-8000-000000000001', repeat('a',64), now(), now());"
expect_refusal "partial active-plan tuple" "evry_conversations_active_plan_shape_check" \
  "INSERT INTO evry_conversations (church_id, actor_user_id, title, active_plan_id, created_at, last_activity_at) VALUES ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Partial plan', '30000000-0000-4000-8000-000000000001', now(), now());"
expect_refusal "foreign message actor" "evry_conversation_messages_conversation_fk" \
  "INSERT INTO evry_conversation_messages (conversation_id, church_id, actor_user_id, request_key, body_fingerprint, request_fingerprint, sequence, author, body, relevance_keys, delivery_status, created_at) VALUES ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000003', repeat('c',64), repeat('e',64), 1, 'user', 'forged', '[]', 'complete', now());"
expect_refusal "artifact discriminator mismatch" "evry_conversation_artifacts_document_check" \
  "INSERT INTO evry_conversation_artifacts (message_id, conversation_id, church_id, actor_user_id, ordinal, kind, document, created_at) VALUES ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1, 'result', '{\"kind\":\"read\"}', now());"
expect_refusal "actor request replay across conversations" "evry_conversation_messages_request_unique_idx" \
  "INSERT INTO evry_conversations (id, church_id, actor_user_id, title, next_message_sequence, created_at, last_activity_at) VALUES ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Second', 1, now(), now()); INSERT INTO evry_conversation_messages (conversation_id, church_id, actor_user_id, request_key, body_fingerprint, request_fingerprint, sequence, author, body, relevance_keys, delivery_status, created_at) VALUES ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', repeat('d',64), repeat('e',64), 0, 'user', 'replay', '[]', 'complete', now());"

before="$(catalog_signature)"
echo "    catalog signature after apply: $before"

echo "==> rolling 0068 back"
run "$PROOF_DATABASE" <<'SQL'
DROP TABLE "evry_conversation_artifacts";
DROP TABLE "evry_conversation_messages";
DROP TABLE "evry_conversation_states";
DROP TABLE "evry_conversations";
SQL

missing="$(run "$PROOF_DATABASE" -At <<'SQL'
SELECT count(*) FROM unnest(ARRAY[
  'evry_conversations', 'evry_conversation_states',
  'evry_conversation_messages', 'evry_conversation_artifacts'
]) name WHERE to_regclass('public.' || name) IS NULL;
SQL
)"
[ "$missing" = "4" ] || {
  echo "rollback left a conversation object behind: $missing" >&2
  exit 1
}
echo "    rollback removed all conversation tables"

echo "==> reapplying 0068"
run "$PROOF_DATABASE" <"$TARGET"
after="$(catalog_signature)"
[ "$after" = "$before" ] || {
  echo "catalog changed across reapply: $before != $after" >&2
  exit 1
}
echo "    catalog signature after reapply: $after"
echo "==> Evry conversation migration proof passed"
