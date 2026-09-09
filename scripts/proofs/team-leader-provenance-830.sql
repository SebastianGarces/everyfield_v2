\set ON_ERROR_STOP on
-- Design proof only. No production schema, migration, or application service is used.
-- Run in a disposable Postgres container; every object below is temporary.
CREATE TEMP TABLE leader_before (
  id text PRIMARY KEY, church_id text NOT NULL, leader_id text
);
INSERT INTO leader_before VALUES ('team', 'plant-a', 'ada');
-- Both assignTeamLeader and syncLeaderOnFill can leave this identical state.
-- This is the current syncLeaderOnVacate predicate, with fixture identifiers.
UPDATE leader_before SET leader_id = NULL
WHERE church_id = 'plant-a' AND id = 'team' AND leader_id = 'ada';
DO $$ BEGIN
  ASSERT (SELECT leader_id IS NULL FROM leader_before WHERE id = 'team'),
    'Current predicate reproduces loss of an explicit appointment';
END $$;
\echo 'REPRODUCED: current person-only vacancy predicate clears an explicit appointment'

CREATE TEMP TABLE leader_design (
  id text PRIMARY KEY,
  church_id text NOT NULL,
  leader_id text,
  leader_source text,
  leader_role_id text,
  CONSTRAINT provenance_shape CHECK (
    (leader_id IS NULL AND leader_source IS NULL AND leader_role_id IS NULL)
    OR
    (leader_id IS NOT NULL AND leader_source IS NOT NULL AND (
      (leader_source IN ('explicit', 'legacy') AND leader_role_id IS NULL)
      OR (leader_source = 'role' AND leader_role_id IS NOT NULL)
    ))
  )
);
INSERT INTO leader_design VALUES
  ('explicit', 'plant-a', 'ada', 'explicit', NULL),
  ('derived', 'plant-a', 'ada', 'role', 'role-a'),
  ('legacy', 'plant-a', 'ada', 'legacy', NULL),
  ('foreign', 'plant-b', 'ada', 'role', 'role-a');

-- Role removal, role deletion and unmarking must all use this same predicate.
CREATE FUNCTION pg_temp.vacate(team text, plant text, person text, role_id text)
RETURNS void LANGUAGE SQL AS $$
  UPDATE leader_design SET leader_id = NULL, leader_source = NULL, leader_role_id = NULL
  WHERE id = team AND church_id = plant AND leader_id = person
    AND leader_source = 'role' AND leader_role_id = role_id
$$;
SELECT pg_temp.vacate('explicit', 'plant-a', 'ada', 'role-a');
SELECT pg_temp.vacate('derived', 'plant-a', 'ada', 'role-b');
SELECT pg_temp.vacate('derived', 'plant-a', 'grace', 'role-a');
SELECT pg_temp.vacate('legacy', 'plant-a', 'ada', 'role-a');
SELECT pg_temp.vacate('foreign', 'plant-a', 'ada', 'role-a');
DO $$ BEGIN
  ASSERT (SELECT count(*) = 4 FROM leader_design WHERE leader_id = 'ada'),
    'Explicit, legacy, unrelated role/person and foreign-tenant vacancies preserve leaders';
END $$;
SELECT pg_temp.vacate('derived', 'plant-a', 'ada', 'role-a');
DO $$ BEGIN
  ASSERT (SELECT leader_id IS NULL AND leader_source IS NULL AND leader_role_id IS NULL
    FROM leader_design WHERE id = 'derived'), 'Source-role vacancy clears all provenance';
END $$;
\echo 'PASS: explicit/legacy preservation, exact role/person matching, tenant predicate, derived clear'

-- Provenance-only transition: the real fill also requires an active-membership
-- EXISTS predicate, intentionally not modeled by this temporary-table design proof.
UPDATE leader_design SET leader_id = 'ada', leader_source = 'role', leader_role_id = 'role-a'
WHERE id = 'derived' AND church_id = 'plant-a' AND leader_id IS NULL;
-- Explicitly appointing the SAME person must still replace the provenance.
UPDATE leader_design SET leader_id = 'ada', leader_source = 'explicit', leader_role_id = NULL
WHERE id = 'derived' AND church_id = 'plant-a';
SELECT pg_temp.vacate('derived', 'plant-a', 'ada', 'role-a');
UPDATE leader_design SET leader_id = 'grace', leader_source = 'role', leader_role_id = 'role-b'
WHERE id = 'derived' AND church_id = 'plant-a' AND leader_id IS NULL;
DO $$ BEGIN
  ASSERT (SELECT leader_id = 'ada' AND leader_source = 'explicit' AND leader_role_id IS NULL
    FROM leader_design WHERE id = 'derived'), 'Same-person explicit appointment wins';
END $$;
\echo 'PASS: explicit same-person conversion and later derived fill protection'

-- AS-016 seat-removal cleanup remains unconditional with respect to source.
INSERT INTO leader_design VALUES ('role-cleanup', 'plant-a', 'ada', 'role', 'role-c');
UPDATE leader_design SET leader_id = NULL, leader_source = NULL, leader_role_id = NULL
WHERE church_id = 'plant-a' AND leader_id = 'ada';
DO $$ BEGIN
  ASSERT (SELECT count(*) = 4 FROM leader_design
    WHERE church_id = 'plant-a' AND leader_id IS NULL AND leader_source IS NULL AND leader_role_id IS NULL);
  ASSERT (SELECT leader_id = 'ada' FROM leader_design WHERE id = 'foreign');
END $$;
\echo 'PASS: source-independent cleanup remains tenant-scoped'

DO $$
DECLARE bad record;
BEGIN
  FOR bad IN SELECT * FROM (VALUES
    ('ada'::text, NULL::text, NULL::text),
    (NULL, 'explicit', NULL),
    ('ada', 'role', NULL),
    ('ada', 'explicit', 'role-a'),
    ('ada', 'unknown', NULL),
    (NULL, NULL, 'role-a')
  ) v(person, source, role_id)
  LOOP
    BEGIN
      INSERT INTO leader_design VALUES ('invalid', 'plant-a', bad.person, bad.source, bad.role_id);
      RAISE EXCEPTION 'Malformed provenance was accepted: %', bad;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
END $$;
\echo 'PASS: six malformed provenance states refused by PostgreSQL'

-- Demonstrate the proposed conservative historical backfill and reversible DDL.
-- This is NOT a versioned migration apply/rollback proof.
INSERT INTO leader_before VALUES ('historical', 'plant-a', 'grace');
ALTER TABLE leader_before ADD COLUMN leader_source text;
ALTER TABLE leader_before ADD COLUMN leader_role_id text;
UPDATE leader_before SET leader_source = 'legacy' WHERE leader_id IS NOT NULL;
DO $$ BEGIN
  ASSERT (SELECT leader_id = 'grace' AND leader_source = 'legacy' FROM leader_before WHERE id = 'historical');
  ASSERT (SELECT leader_source IS NULL FROM leader_before WHERE id = 'team');
END $$;
ALTER TABLE leader_before DROP COLUMN leader_source, DROP COLUMN leader_role_id;
DO $$ BEGIN
  ASSERT (SELECT leader_id = 'grace' FROM leader_before WHERE id = 'historical');
END $$;
\echo 'PASS: design backfill preserves historical leader; removing proposed columns retains leader'
\echo 'LIMIT: no application flow, concurrency, FK lifecycle, authorization, or browser validation'
