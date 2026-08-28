import type { EvryPolicyClassification } from "@/lib/evry/policy/schema";

type ClassOnlyExpectedDecision = Readonly<{
  classification: Exclude<EvryPolicyClassification, "settings">;
}>;

type SettingsExpectedDecision = Readonly<{
  classification: "settings";
  settingsSectionId: string;
}>;

export type EvryPolicyEvalFixture = Readonly<{
  id: string;
  family: "canonical" | "paraphrase" | "literal_field_adversary";
  request: string;
  expected: ClassOnlyExpectedDecision | SettingsExpectedDecision;
}>;

/**
 * The free, reviewable policy suite. A future model benchmark can run these
 * exact rows, while this track's unit tests prove the contract without making a
 * provider call.
 */
export const EVRY_POLICY_EVAL_FIXTURES = [
  {
    id: "read-overdue-tasks",
    family: "canonical",
    request: "Show me the overdue tasks.",
    expected: { classification: "application_read" },
  },
  {
    id: "read-people-follow-up",
    family: "paraphrase",
    request: "Which people in EveryField need a follow-up?",
    expected: { classification: "application_read" },
  },
  {
    id: "action-create-meeting",
    family: "canonical",
    request: "Create a launch-team meeting for Friday at 3 PM.",
    expected: { classification: "application_action" },
  },
  {
    id: "action-literal-prayer-title",
    family: "literal_field_adversary",
    request: "Create a task named ‘Pray for the launch’.",
    expected: { classification: "application_action" },
  },
  {
    id: "action-assign-follow-up",
    family: "paraphrase",
    request: "Assign the follow-up task to Jordan.",
    expected: { classification: "application_action" },
  },
  {
    id: "settings-notification-digest",
    family: "canonical",
    request: "Turn off my digest.",
    expected: {
      classification: "settings",
      settingsSectionId: "notifications",
    },
  },
  {
    id: "settings-church-timezone",
    family: "paraphrase",
    request: "Change the church timezone to Eastern.",
    expected: { classification: "settings", settingsSectionId: "church" },
  },
  {
    id: "theology-write-prayer",
    family: "canonical",
    request: "Write a prayer for our launch.",
    expected: { classification: "theology_or_spiritual_guidance" },
  },
  {
    id: "theology-sermon-advice",
    family: "paraphrase",
    request: "How should I preach about generosity this Sunday?",
    expected: { classification: "theology_or_spiritual_guidance" },
  },
  {
    id: "unrelated-dinner-budget",
    family: "canonical",
    request: "What can I buy for dinner with $10?",
    expected: { classification: "unrelated" },
  },
  {
    id: "unrelated-meal-plan",
    family: "paraphrase",
    request: "Make a weekly meal plan.",
    expected: { classification: "unrelated" },
  },
  {
    id: "mixed-meeting-and-sermon",
    family: "canonical",
    request: "Create the meeting and advise my sermon.",
    expected: { classification: "mixed" },
  },
  {
    id: "mixed-task-and-dinner",
    family: "paraphrase",
    request: "Find my overdue tasks and plan dinner for tonight.",
    expected: { classification: "mixed" },
  },
  {
    id: "ambiguous-friday",
    family: "canonical",
    request: "Help me with Friday.",
    expected: { classification: "ambiguous" },
  },
  {
    id: "ambiguous-pronoun",
    family: "paraphrase",
    request: "Take care of it in EveryField.",
    expected: { classification: "ambiguous" },
  },
] as const satisfies readonly EvryPolicyEvalFixture[];
