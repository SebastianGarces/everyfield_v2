import { z } from "zod";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryPageContext } from "@/lib/evry/resolvers/contract";
import {
  executeAuthorizedEvryRead,
  type EvryReadRegistration,
} from "@/lib/evry/reads/contract";
import { PEOPLE_QUERY_READS } from "@/lib/evry/capabilities/queries/people";
import { OPERATIONS_QUERY_READS } from "@/lib/evry/capabilities/queries/operations";
import { CONTENT_QUERY_READS } from "@/lib/evry/capabilities/queries/content";
import { EVE_CAPABILITY_CATALOG } from "./catalog";
import {
  createEveHelperTools,
  productionEveHelperDependencies,
  type EveHelperDependencies,
} from "./helpers";

export type EveJsonValue =
  | null
  | boolean
  | number
  | string
  | EveJsonValue[]
  | { [key: string]: EveJsonValue };
export type EveToolInvocation = Readonly<{
  signal?: AbortSignal;
  callId?: string;
}>;
export type EveToolDescription = Readonly<{
  name: string;
  description: string;
  inputSchema: z.ZodType;
  effect: "read" | "prepare";
}>;
export type EveToolContext = Readonly<{
  actor: Pick<EvryPlantActor, "userId" | "plantId">;
  literalUserText: string;
  pageContext: EvryPageContext | null;
  now: Date;
}>;
export type EvePreparation = Readonly<{
  inputSchema: z.ZodType;
  /** Must refresh actor authority and bind the immutable plan to this call ID. */
  prepare(
    input: unknown,
    invocation: { callId: string; signal?: AbortSignal }
  ): Promise<unknown>;
}>;
export type EveToolRegistry = Readonly<{
  describe(): readonly EveToolDescription[];
  invoke(
    name: string,
    input: unknown,
    invocation?: EveToolInvocation
  ): Promise<EveJsonValue>;
}>;

const baselineReads = [
  ...PEOPLE_QUERY_READS,
  ...OPERATIONS_QUERY_READS,
  ...CONTENT_QUERY_READS,
];
const descriptions = new Map<string, string>(
  EVE_CAPABILITY_CATALOG.map(([name, description]) => [name, description])
);

/** The same registry powers direct Eve tools and the isolated composition broker. */
export function createEveToolRegistry(options: {
  context: EveToolContext;
  authorizeRead(
    identity: string
  ): Promise<EvryReadCapabilityAuthorization | null>;
  preparation?: EvePreparation;
  helperDependencies?: EveHelperDependencies;
  /** Isolated adapters exercise the actual registry without a shared database. */
  reads?: readonly EvryReadRegistration[];
}): EveToolRegistry {
  const { context } = options;
  const reads = options.reads ?? baselineReads;
  const helpers = createEveHelperTools(
    options.helperDependencies ?? productionEveHelperDependencies,
    new Date(context.now)
  );
  const readMap = new Map(reads.map((read) => [read.id, read]));
  const helperMap = new Map(helpers.map((helper) => [helper.name, helper]));
  const contracts: readonly EveToolDescription[] = Object.freeze([
    ...reads.map((read) => ({
      name: read.id,
      description:
        descriptions.get(read.id) ?? read.inputSchema.description ?? read.id,
      inputSchema: read.inputSchema,
      effect: "read" as const,
    })),
    ...helpers.map((helper) => ({
      name: helper.name,
      description: helper.description,
      inputSchema: helper.inputSchema,
      effect: "read" as const,
    })),
    ...(options.preparation
      ? [
          {
            name: "actions.prepare",
            description: descriptions.get("actions.prepare")!,
            inputSchema: options.preparation.inputSchema,
            effect: "prepare" as const,
          },
        ]
      : []),
  ]);
  if (new Set(contracts.map((entry) => entry.name)).size !== contracts.length)
    throw new Error("Duplicate Eve tool registration");
  const contractMap = new Map(
    contracts.map((contract) => [contract.name, contract])
  );
  return {
    describe: () => contracts,
    async invoke(name, input, invocation = {}) {
      invocation.signal?.throwIfAborted();
      const contract = contractMap.get(name);
      if (!contract) return { status: "unavailable", reason: "unknown_tool" };
      let result: unknown;
      if (contract.effect === "prepare") {
        if (!invocation.callId?.trim() || !options.preparation)
          return { status: "unavailable", reason: "missing_call_identity" };
        const parsed = contract.inputSchema.safeParse(input);
        if (!parsed.success)
          return {
            status: "invalid_input",
            issues: parsed.error.issues.map(({ path, message }) => ({
              path: path.map(String).join("."),
              message,
            })),
          };
        result = await options.preparation.prepare(parsed.data, {
          callId: invocation.callId,
          signal: invocation.signal,
        });
      } else {
        const read = readMap.get(name);
        const helper = helperMap.get(name);
        const identity = read?.capabilityIdentity ?? helper?.capabilityIdentity;
        if (!identity) return { status: "unavailable", reason: "unknown_tool" };
        const authorization = await options.authorizeRead(identity);
        if (
          !authorization ||
          authorization.actor.userId !== context.actor.userId ||
          authorization.actor.plantId !== context.actor.plantId ||
          authorization.registration.identity !== identity
        )
          return { status: "unavailable", reason: "not_authorized" };
        invocation.signal?.throwIfAborted();
        const parsed = contract.inputSchema.safeParse(input);
        if (!parsed.success)
          return {
            status: "invalid_input",
            issues: parsed.error.issues.map(({ path, message }) => ({
              path: path.map(String).join("."),
              message,
            })),
          };
        result = read
          ? await executeAuthorizedEvryRead(
              read,
              authorization,
              {
                literalUserText: context.literalUserText,
                pageContext: context.pageContext,
                now: context.now,
              },
              parsed.data
            )
          : await helper!.run(authorization, parsed.data);
      }
      invocation.signal?.throwIfAborted();
      if (result === null || result === undefined)
        return { status: "unavailable" };
      // Strip private brands, then validate the wire value. No functions, cycles or BigInts escape.
      return z.json().parse(JSON.parse(JSON.stringify(result)));
    },
  };
}
