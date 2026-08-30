import { z } from "zod";

import {
  isEvryReadCapabilityIdentity,
  type EvryReadCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryExecutionCapabilityRegistry } from "@/lib/evry/executor";
import type { EvryJsonValue } from "@/lib/evry/plans";

const RECIPE_ID_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;
const STEP_ID_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const INPUT_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const ARGUMENT_KEY_PATTERN = /^[a-z][A-Za-z0-9_]{0,63}$/;

const recipeIdentitySchema = z.string().regex(RECIPE_ID_PATTERN);
const stepIdSchema = z.string().regex(STEP_ID_PATTERN);
const inputKeySchema = z.string().regex(INPUT_KEY_PATTERN);
const argumentKeySchema = z.string().regex(ARGUMENT_KEY_PATTERN);
const pathSegmentSchema = z.string().min(1).max(64);
const capabilityIdentitySchema = z.string().trim().min(1).max(300);
const displayTextSchema = z.string().trim().min(1).max(1_000);

const jsonValueSchema: z.ZodType<EvryJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

const inputValueSchema = z.custom<z.ZodType<unknown>>(
  (value) => value instanceof z.ZodType,
  "Recipe input fields must use a Zod schema"
);

const inputDefinitionSchema = z.strictObject({
  key: inputKeySchema,
  schema: inputValueSchema,
});

const recordResolverUseSchema = z.strictObject({
  inputKey: inputKeySchema,
  resolverIdentity: recipeIdentitySchema,
});

const argumentBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("input"), inputKey: inputKeySchema }),
  z.strictObject({
    kind: z.literal("input_path"),
    inputKey: inputKeySchema,
    path: z.array(pathSegmentSchema).min(1).max(16),
  }),
  z.strictObject({ kind: z.literal("literal"), value: jsonValueSchema }),
]);

const disclosureValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("argument"),
    argumentKey: argumentKeySchema,
    absentValue: z.string().min(1).max(1_000).optional(),
  }),
  z.strictObject({
    kind: z.literal("argument_summary"),
    argumentKey: argumentKeySchema,
    absentValue: z.string().min(1).max(1_000).optional(),
  }),
  z.strictObject({
    kind: z.literal("literal"),
    value: z.string().min(1).max(4_000),
  }),
]);

const stepDisclosureSchema = z.strictObject({
  title: displayTextSchema,
  items: z
    .array(
      z.strictObject({
        label: displayTextSchema,
        value: disclosureValueSchema,
      })
    )
    .min(1)
    .max(32),
  consequences: z.array(displayTextSchema).min(1).max(16),
});

const recipeStepSchema = z.strictObject({
  id: stepIdSchema,
  capabilityIdentity: capabilityIdentitySchema,
  arguments: z.record(argumentKeySchema, argumentBindingSchema),
  dependsOn: z.array(stepIdSchema),
  disclosure: stepDisclosureSchema,
  failurePolicy: z.strictObject({
    retry: z.enum(["same_plan", "never"]),
  }),
});

const recipeDefinitionSchema = z.strictObject({
  identity: recipeIdentitySchema,
  requiredInputs: z.array(inputDefinitionSchema),
  optionalInputs: z.array(inputDefinitionSchema),
  recordResolvers: z.array(recordResolverUseSchema),
  preconditions: z.array(recipeIdentitySchema),
  eligibleCapabilities: z.array(capabilityIdentitySchema).min(1),
  confirmation: z.strictObject({
    title: displayTextSchema,
    actionLabel: displayTextSchema,
  }),
  steps: z.array(recipeStepSchema).min(1),
});

export type EvryRecipeArgumentBinding =
  | Readonly<{ kind: "input"; inputKey: string }>
  | Readonly<{
      kind: "input_path";
      inputKey: string;
      path: readonly string[];
    }>
  | Readonly<{ kind: "literal"; value: EvryJsonValue }>;
export type EvryRecipeDisclosureValue = Readonly<
  z.infer<typeof disclosureValueSchema>
>;
export type EvryRecipeInputDefinition = Readonly<
  z.infer<typeof inputDefinitionSchema>
>;
type ParsedRecipeStepDefinition = z.infer<typeof recipeStepSchema>;
export type EvryRecipeStepDefinition = Readonly<
  Omit<
    ParsedRecipeStepDefinition,
    "arguments" | "dependsOn" | "disclosure" | "failurePolicy"
  > & {
    arguments: Readonly<Record<string, EvryRecipeArgumentBinding>>;
    dependsOn: readonly string[];
    disclosure: Readonly<{
      title: string;
      items: readonly Readonly<{
        label: string;
        value: EvryRecipeDisclosureValue;
      }>[];
      consequences: readonly string[];
    }>;
    failurePolicy: Readonly<{ retry: "same_plan" | "never" }>;
  }
>;
type ParsedRecipeDefinition = z.infer<typeof recipeDefinitionSchema>;
export type EvryRecipeDefinition = Readonly<
  Omit<
    ParsedRecipeDefinition,
    | "requiredInputs"
    | "optionalInputs"
    | "recordResolvers"
    | "preconditions"
    | "eligibleCapabilities"
    | "confirmation"
    | "steps"
  > & {
    requiredInputs: readonly EvryRecipeInputDefinition[];
    optionalInputs: readonly EvryRecipeInputDefinition[];
    recordResolvers: readonly Readonly<{
      inputKey: string;
      resolverIdentity: string;
    }>[];
    preconditions: readonly string[];
    eligibleCapabilities: readonly string[];
    confirmation: Readonly<{ title: string; actionLabel: string }>;
    steps: readonly EvryRecipeStepDefinition[];
  }
>;

const EVRY_RECIPE_RESOLVER: unique symbol = Symbol("EvryRecipeResolver");
const EVRY_RECIPE_PRECONDITION: unique symbol = Symbol(
  "EvryRecipePrecondition"
);
const EVRY_RECIPE_REGISTRY: unique symbol = Symbol("EvryRecipeRegistry");

export type EvryRecipeResolverRegistration = Readonly<{
  identity: string;
  readCapabilityIdentity: string;
  resolve(input: {
    authorization: EvryReadCapabilityAuthorization;
    rawValue: unknown;
  }): Promise<unknown>;
  [EVRY_RECIPE_RESOLVER]: true;
}>;

export type EvryRecipeResolvedInputs = Readonly<
  Record<string, EvryJsonValue | undefined>
>;

export type EvryRecipePreconditionRegistration = Readonly<{
  identity: string;
  check(inputs: EvryRecipeResolvedInputs): Promise<boolean>;
  [EVRY_RECIPE_PRECONDITION]: true;
}>;

export type EvryRecipeRegistry = Readonly<{
  executionRegistry: EvryExecutionCapabilityRegistry;
  registrationFor(identity: string): EvryRecipeDefinition | null;
  resolverFor(identity: string): EvryRecipeResolverRegistration | null;
  preconditionFor(identity: string): EvryRecipePreconditionRegistration | null;
  registrations(): readonly EvryRecipeDefinition[];
  [EVRY_RECIPE_REGISTRY]: true;
}>;

export class EvryRecipeRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvryRecipeRegistrationError";
  }
}

/**
 * Register an input adapter against one generated read capability. The fresh
 * authorization object is required at invocation and cannot be stored in the
 * recipe declaration or replaced by caller data.
 */
export function defineEvryRecipeResolver(input: {
  identity: string;
  readCapabilityIdentity: string;
  resolve(input: {
    authorization: EvryReadCapabilityAuthorization;
    rawValue: unknown;
  }): Promise<unknown>;
}): EvryRecipeResolverRegistration {
  if (!recipeIdentitySchema.safeParse(input.identity).success) {
    throw new EvryRecipeRegistrationError("Invalid Evry resolver identity");
  }
  if (!isEvryReadCapabilityIdentity(input.readCapabilityIdentity)) {
    throw new EvryRecipeRegistrationError(
      `Evry resolver does not reference an authoritative read: ${input.identity}`
    );
  }
  return Object.freeze({
    ...input,
    [EVRY_RECIPE_RESOLVER]: true as const,
  });
}

export function defineEvryRecipePrecondition(input: {
  identity: string;
  check(inputs: EvryRecipeResolvedInputs): boolean | Promise<boolean>;
}): EvryRecipePreconditionRegistration {
  if (!recipeIdentitySchema.safeParse(input.identity).success) {
    throw new EvryRecipeRegistrationError(
      "Invalid Evry recipe precondition identity"
    );
  }
  return Object.freeze({
    identity: input.identity,
    check: async (inputs: EvryRecipeResolvedInputs) => input.check(inputs),
    [EVRY_RECIPE_PRECONDITION]: true as const,
  });
}

function unique(values: readonly string[], subject: string): void {
  if (new Set(values).size !== values.length) {
    throw new EvryRecipeRegistrationError(`Duplicate Evry recipe ${subject}`);
  }
}

function validateGraph(steps: readonly EvryRecipeStepDefinition[]): void {
  const byId = new Map(steps.map((step) => [step.id, step]));
  unique(
    steps.map(({ id }) => id),
    "step"
  );

  for (const step of steps) {
    unique(step.dependsOn, `dependency on ${step.id}`);
    for (const dependency of step.dependsOn) {
      if (!byId.has(dependency)) {
        throw new EvryRecipeRegistrationError(
          `Evry recipe step ${step.id} depends on unknown step ${dependency}`
        );
      }
      if (dependency === step.id) {
        throw new EvryRecipeRegistrationError(
          `Evry recipe step ${step.id} depends on itself`
        );
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(stepId: string): void {
    if (visited.has(stepId)) return;
    if (visiting.has(stepId)) {
      throw new EvryRecipeRegistrationError(
        "Evry recipe dependencies contain a cycle"
      );
    }
    visiting.add(stepId);
    for (const dependency of byId.get(stepId)?.dependsOn ?? []) {
      visit(dependency);
    }
    visiting.delete(stepId);
    visited.add(stepId);
  }
  for (const stepId of byId.keys()) visit(stepId);
}

function freezeDefinition(
  definition: EvryRecipeDefinition
): EvryRecipeDefinition {
  function freezeJson(value: EvryJsonValue): EvryJsonValue {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        return Object.freeze(value.map(freezeJson));
      }
      return Object.freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, freezeJson(child)])
        )
      );
    }
    return value;
  }

  const freezeInput = (input: EvryRecipeInputDefinition) =>
    Object.freeze({ ...input });
  const requiredInputs = Object.freeze(
    definition.requiredInputs.map(freezeInput)
  );
  const optionalInputs = Object.freeze(
    definition.optionalInputs.map(freezeInput)
  );
  const recordResolvers = Object.freeze(
    definition.recordResolvers.map((resolver) => Object.freeze({ ...resolver }))
  );
  const preconditions = Object.freeze([...definition.preconditions]);
  const eligibleCapabilities = Object.freeze([
    ...definition.eligibleCapabilities,
  ]);
  const steps = Object.freeze(
    definition.steps.map((step) =>
      Object.freeze({
        ...step,
        arguments: Object.freeze(
          Object.fromEntries(
            Object.entries(step.arguments).map(([key, binding]) => [
              key,
              Object.freeze(
                binding.kind === "literal"
                  ? { ...binding, value: freezeJson(binding.value) }
                  : binding.kind === "input_path"
                    ? { ...binding, path: Object.freeze([...binding.path]) }
                    : { ...binding }
              ),
            ])
          )
        ),
        dependsOn: Object.freeze([...step.dependsOn]),
        disclosure: Object.freeze({
          ...step.disclosure,
          items: Object.freeze(
            step.disclosure.items.map((item) =>
              Object.freeze({
                ...item,
                value: Object.freeze({ ...item.value }),
              })
            )
          ),
          consequences: Object.freeze([...step.disclosure.consequences]),
        }),
        failurePolicy: Object.freeze({ ...step.failurePolicy }),
      })
    )
  );

  return Object.freeze({
    ...definition,
    requiredInputs,
    optionalInputs,
    recordResolvers,
    preconditions,
    eligibleCapabilities,
    confirmation: Object.freeze({ ...definition.confirmation }),
    steps,
  });
}

function validateDefinition(input: {
  definition: EvryRecipeDefinition;
  executionRegistry: EvryExecutionCapabilityRegistry;
  resolvers: ReadonlyMap<string, EvryRecipeResolverRegistration>;
  preconditions: ReadonlyMap<string, EvryRecipePreconditionRegistration>;
}): void {
  const { definition } = input;
  const allInputs = [
    ...definition.requiredInputs,
    ...definition.optionalInputs,
  ];
  unique(
    allInputs.map(({ key }) => key),
    "input"
  );
  unique(
    definition.recordResolvers.map(({ inputKey }) => inputKey),
    "record resolver input"
  );
  unique(definition.preconditions, "precondition");
  unique(definition.eligibleCapabilities, "eligible capability");
  validateGraph(definition.steps);

  const inputKeys = new Set(allInputs.map(({ key }) => key));
  for (const resolver of definition.recordResolvers) {
    if (!inputKeys.has(resolver.inputKey)) {
      throw new EvryRecipeRegistrationError(
        `Evry recipe resolver targets unknown input ${resolver.inputKey}`
      );
    }
    if (!input.resolvers.has(resolver.resolverIdentity)) {
      throw new EvryRecipeRegistrationError(
        `Unknown Evry recipe resolver: ${resolver.resolverIdentity}`
      );
    }
  }
  for (const precondition of definition.preconditions) {
    if (!input.preconditions.has(precondition)) {
      throw new EvryRecipeRegistrationError(
        `Unknown Evry recipe precondition: ${precondition}`
      );
    }
  }

  const declaredCapabilities = new Set(definition.eligibleCapabilities);
  for (const identity of declaredCapabilities) {
    if (!input.executionRegistry.registrationFor(identity)) {
      throw new EvryRecipeRegistrationError(
        `Unknown Evry recipe capability: ${identity}`
      );
    }
  }

  const usedCapabilities = new Set<string>();
  for (const step of definition.steps) {
    if (!declaredCapabilities.has(step.capabilityIdentity)) {
      throw new EvryRecipeRegistrationError(
        `Evry recipe step ${step.id} contains a hidden effect`
      );
    }
    usedCapabilities.add(step.capabilityIdentity);

    for (const binding of Object.values(step.arguments)) {
      if (binding.kind !== "literal" && !inputKeys.has(binding.inputKey)) {
        throw new EvryRecipeRegistrationError(
          `Evry recipe step ${step.id} binds unknown input ${binding.inputKey}`
        );
      }
    }
    const disclosedArguments = step.disclosure.items.flatMap((item) =>
      item.value.kind === "literal" ? [] : [item.value.argumentKey]
    );
    unique(disclosedArguments, `disclosed argument on ${step.id}`);
    for (const item of step.disclosure.items) {
      if (
        item.value.kind !== "literal" &&
        !Object.hasOwn(step.arguments, item.value.argumentKey)
      ) {
        throw new EvryRecipeRegistrationError(
          `Evry recipe step ${step.id} discloses unknown argument ${item.value.argumentKey}`
        );
      }
    }
    for (const argumentKey of Object.keys(step.arguments)) {
      if (!disclosedArguments.includes(argumentKey)) {
        throw new EvryRecipeRegistrationError(
          `Evry recipe step ${step.id} does not disclose argument ${argumentKey}`
        );
      }
    }
  }

  for (const identity of declaredCapabilities) {
    if (!usedCapabilities.has(identity)) {
      throw new EvryRecipeRegistrationError(
        `Evry recipe declares an unused capability: ${identity}`
      );
    }
  }
}

/**
 * Register strict declarative recipes against exact trusted resolver and
 * execution registrations. A recipe has no field for permission,
 * confirmation, executor, or eval overrides; those contracts remain owned by
 * the referenced capability registrations and the global plan executor.
 */
export function createEvryRecipeRegistry(input: {
  executionRegistry: EvryExecutionCapabilityRegistry;
  resolvers: readonly EvryRecipeResolverRegistration[];
  preconditions: readonly EvryRecipePreconditionRegistration[];
  definitions: readonly unknown[];
}): EvryRecipeRegistry {
  const resolvers = new Map<string, EvryRecipeResolverRegistration>();
  for (const resolver of input.resolvers) {
    if (resolvers.has(resolver.identity)) {
      throw new EvryRecipeRegistrationError(
        `Duplicate Evry recipe resolver: ${resolver.identity}`
      );
    }
    resolvers.set(resolver.identity, resolver);
  }

  const preconditions = new Map<string, EvryRecipePreconditionRegistration>();
  for (const precondition of input.preconditions) {
    if (preconditions.has(precondition.identity)) {
      throw new EvryRecipeRegistrationError(
        `Duplicate Evry recipe precondition: ${precondition.identity}`
      );
    }
    preconditions.set(precondition.identity, precondition);
  }

  const definitions = new Map<string, EvryRecipeDefinition>();
  for (const candidate of input.definitions) {
    const parsed = recipeDefinitionSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new EvryRecipeRegistrationError(
        "Evry recipe definition has an invalid shape"
      );
    }
    if (definitions.has(parsed.data.identity)) {
      throw new EvryRecipeRegistrationError(
        `Duplicate Evry recipe identity: ${parsed.data.identity}`
      );
    }
    validateDefinition({
      definition: parsed.data,
      executionRegistry: input.executionRegistry,
      resolvers,
      preconditions,
    });
    definitions.set(parsed.data.identity, freezeDefinition(parsed.data));
  }

  return Object.freeze({
    executionRegistry: input.executionRegistry,
    registrationFor(identity: string) {
      return definitions.get(identity) ?? null;
    },
    resolverFor(identity: string) {
      return resolvers.get(identity) ?? null;
    },
    preconditionFor(identity: string) {
      return preconditions.get(identity) ?? null;
    },
    registrations() {
      return Object.freeze([...definitions.values()]);
    },
    [EVRY_RECIPE_REGISTRY]: true as const,
  });
}
