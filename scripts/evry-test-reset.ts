import { EVRY_TEST_CHURCH_ID } from "./evry-test-fixtures";

/** QA-only dependents, in deletion order. Never delete immutable Evry history. */
export const EVRY_TEST_OPERATIONAL_RESET_TABLES = [
  "communication_failed_retries",
  "meeting_confirmation_tokens",
  "insight_feedback",
  "plant_insights",
  "plant_assessments",
] as const;

/** Shared with the isolated reset proof; the target is never caller-selected. */
export const EVRY_TEST_EXECUTION_RESET_GUARD = `
  IF EXISTS (SELECT 1 FROM evry_active_runs WHERE church_id = '${EVRY_TEST_CHURCH_ID}' AND status = 'active' AND expires_at > now()) THEN
    RAISE EXCEPTION 'Evry request is running; wait for it to finish before resetting';
  END IF;
  IF EXISTS (SELECT 1 FROM evry_action_plans p JOIN evry_action_plan_states s ON s.plan_id = p.id
    WHERE p.church_id = '${EVRY_TEST_CHURCH_ID}' AND (s.status = 'executing' OR (p.expires_at > now() AND s.status IN ('awaiting_confirmation','approved')))) THEN
    RAISE EXCEPTION 'Evry plan is still actionable; finish or recover execution, or let an unconfirmed plan expire before resetting';
  END IF;
  IF EXISTS (SELECT 1 FROM evry_execution_effect_claims c WHERE c.church_id = '${EVRY_TEST_CHURCH_ID}' AND NOT EXISTS
    (SELECT 1 FROM evry_execution_outcomes o WHERE o.church_id = c.church_id AND o.effect_key = c.effect_key AND o.subject = 'step' AND o.status = 'completed')) THEN
    RAISE EXCEPTION 'Evry has an unreconciled execution effect; recover it before resetting';
  END IF;`;

export function evryTestOperationalResetStatements() {
  return EVRY_TEST_OPERATIONAL_RESET_TABLES.map((table) => ({
    sql: `DELETE FROM "${table}" WHERE church_id = $1`,
    params: [EVRY_TEST_CHURCH_ID],
  }));
}
