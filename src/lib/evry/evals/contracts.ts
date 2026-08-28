export const EVRY_CAPABILITY_EVAL_LAYERS = [
  "policy",
  "selection",
  "arguments",
  "tenancy",
  "permission",
  "confirmation",
  "execution",
  "idempotency",
  "errors",
  "ui_artifact",
] as const;

export type EvryCapabilityEvalLayer =
  (typeof EVRY_CAPABILITY_EVAL_LAYERS)[number];

export const EVRY_RECIPE_EVAL_LAYERS = [
  "end_to_end",
  "partial_failure",
] as const;

export type EvryRecipeEvalLayer = (typeof EVRY_RECIPE_EVAL_LAYERS)[number];

export const EVRY_ABSOLUTE_SAFETY_GATES = [
  "cross_tenant_access",
  "unconfirmed_effect",
  "prohibited_tool_access",
  "plan_approval_mismatch",
] as const;

export type EvryAbsoluteSafetyGate =
  (typeof EVRY_ABSOLUTE_SAFETY_GATES)[number];

export type EvryEvalCase = Readonly<{
  id: string;
  proof: string;
}>;

export type EvryCapabilityEvalFixture = Readonly<{
  capabilityIdentity: string;
  cases: Readonly<Record<EvryCapabilityEvalLayer, readonly EvryEvalCase[]>>;
}>;

export type EvryRecipeEvalFixture = Readonly<{
  recipeIdentity: string;
  cases: Readonly<Record<EvryRecipeEvalLayer, readonly EvryEvalCase[]>>;
}>;

export type EvrySafetyGateResult = Readonly<{
  gate: EvryAbsoluteSafetyGate;
  passed: boolean;
  proof: string;
}>;

function assertIdentity(value: string, subject: string): void {
  if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(value)) {
    throw new Error(`${subject} needs a stable identity`);
  }
}

function assertCompleteCases<Layer extends string>(input: {
  subject: string;
  requiredLayers: readonly Layer[];
  cases: Readonly<Partial<Record<Layer, readonly EvryEvalCase[]>>>;
}): void {
  const known = new Set(input.requiredLayers);
  for (const layer of Object.keys(input.cases)) {
    if (!known.has(layer as Layer)) {
      throw new Error(`${input.subject} has unknown eval layer ${layer}`);
    }
  }
  for (const layer of input.requiredLayers) {
    const cases = input.cases[layer];
    if (!cases || cases.length === 0) {
      throw new Error(`${input.subject} is missing eval layer ${layer}`);
    }
    const ids = cases.map(({ id }) => id);
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      throw new Error(`${input.subject} has invalid eval cases in ${layer}`);
    }
  }
}

export function defineEvryCapabilityEvalFixture(
  fixture: EvryCapabilityEvalFixture
): EvryCapabilityEvalFixture {
  assertIdentity(fixture.capabilityIdentity, "Evry capability eval fixture");
  assertCompleteCases({
    subject: fixture.capabilityIdentity,
    requiredLayers: EVRY_CAPABILITY_EVAL_LAYERS,
    cases: fixture.cases,
  });
  return Object.freeze(fixture);
}

export function defineEvryRecipeEvalFixture(
  fixture: EvryRecipeEvalFixture
): EvryRecipeEvalFixture {
  assertIdentity(fixture.recipeIdentity, "Evry recipe eval fixture");
  assertCompleteCases({
    subject: fixture.recipeIdentity,
    requiredLayers: EVRY_RECIPE_EVAL_LAYERS,
    cases: fixture.cases,
  });
  return Object.freeze(fixture);
}

export function assertEvryAbsoluteSafetyGates(
  results: readonly EvrySafetyGateResult[]
): void {
  for (const gate of EVRY_ABSOLUTE_SAFETY_GATES) {
    const matches = results.filter((result) => result.gate === gate);
    if (matches.length !== 1) {
      throw new Error(`Evry safety gate ${gate} needs exactly one result`);
    }
    if (!matches[0]?.passed) {
      throw new Error(`Evry safety gate failed: ${gate}`);
    }
  }
}
