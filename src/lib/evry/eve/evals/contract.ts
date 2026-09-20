import { z } from "zod";

export const evalQuestionSchema = z.strictObject({
  id: z.string().min(1),
  domain: z.string().min(1),
  turns: z.array(z.string().min(1)).min(1),
  likelihood: z.enum(["high", "medium", "low"]),
  shape: z.string(),
  tools: z.array(z.string()),
  expected: z.string().min(1),
  recipe: z.string().nullable(),
});

export const safetyGates = [
  "tenant_isolation",
  "actor_authorization",
  "confirmation_required",
  "approval_matches_plan",
  "replay_no_duplicate_effect",
  "sandbox_containment",
  "untrusted_content_is_data",
] as const;
export const safetyGateSchema = z.enum(safetyGates);

const factValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);
export const expectationsSchema = z.strictObject({
  // Symbols are resolved by the fixture, never guessed from response prose.
  facts: z.record(z.string(), factValue),
  absentRecordIds: z.array(z.string()),
  requiredEvidence: z.array(z.string()),
  maxClarifications: z.number().int().nonnegative(),
  maxToolCalls: z.number().int().positive(),
  expectedEffects: z.record(z.string(), z.number().int().nonnegative()),
  requiredSafetyGates: z.array(safetyGateSchema),
});

export const regressionSchema = z.strictObject({
  id: z.string().min(1),
  domain: z.string(),
  turns: z.array(z.string().min(1)).min(1),
  fixture: z.string().min(1),
  expected: z.string().min(1),
  tags: z.array(
    z.enum([
      "smoke",
      "multi_turn",
      "security",
      "write",
      "recovery",
      "quality",
      "calendar",
    ])
  ),
  expectations: expectationsSchema,
});
export type EvalQuestion = z.infer<typeof evalQuestionSchema>;
export type Regression = z.infer<typeof regressionSchema>;
export type Expectations = z.infer<typeof expectationsSchema>;

export const observationSchema = z.strictObject({
  caseId: z.string(),
  runId: z.string().min(1),
  buildSha: z.string().regex(/^[a-f0-9]{40}$/),
  model: z.literal("gpt-5.6-luna"),
  fixtureDigest: z.string().regex(/^[a-f0-9]{64}$/),
  // Produced by tool/result and database instrumentation, not a model judge.
  facts: z.record(z.string(), factValue),
  exposedRecordIds: z.array(z.string()),
  evidence: z.array(z.string()),
  clarificationCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  effects: z.record(z.string(), z.number().int().nonnegative()),
  safety: z.array(
    z.strictObject({
      gate: safetyGateSchema,
      passed: z.boolean(),
      proof: z.string().min(1),
    })
  ),
  answer: z.string(),
  latency: z.strictObject({
    acknowledgementMs: z.number().nonnegative(),
    firstTextMs: z.number().nonnegative().nullable(),
    totalMs: z.number().nonnegative(),
  }),
  costUsd: z.number().nonnegative(),
  judge: z
    .strictObject({
      model: z.string(),
      grounded: z.boolean(),
      useful: z.boolean(),
      natural: z.boolean(),
      explanation: z.string(),
    })
    .nullable(),
});
export type Observation = z.infer<typeof observationSchema>;

export type CaseResult = Readonly<{
  id: string;
  status: "passed" | "failed" | "not_run" | "blocked";
  failures: readonly string[];
  observation?: Observation;
}>;
