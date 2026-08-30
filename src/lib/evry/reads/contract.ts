import { z } from "zod";

import {
  authorizeEvryReadCapability,
  type EvryCapabilityRegistration,
  type EvryReadCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";

import type { EvryReadContinuationArtifact } from "../artifacts/types";
import type { EvryPageContext } from "../resolvers/contract";

const EVRY_READ_REGISTRATION: unique symbol = Symbol("EvryReadRegistration");
const EVRY_AUTHORIZED_READ_RUN: unique symbol = Symbol("EvryAuthorizedReadRun");

export type EvryReadExecutionContext = Readonly<{
  authorization: EvryReadCapabilityAuthorization;
  literalUserText: string;
  pageContext: EvryPageContext | null;
}>;

type EvryReadInvocationContext = Readonly<
  Omit<EvryReadExecutionContext, "authorization">
>;

export type EvryReadRegistration = Readonly<{
  id: string;
  capabilityIdentity: string;
  execute: (
    context: EvryReadInvocationContext,
    untrustedInput: unknown
  ) => Promise<EvryReadContinuationArtifact | null>;
  [EVRY_AUTHORIZED_READ_RUN]: (
    context: EvryReadExecutionContext,
    untrustedInput: unknown
  ) => Promise<EvryReadContinuationArtifact | null>;
  [EVRY_READ_REGISTRATION]: true;
}>;

/** Execute one closed read after a caller has already minted exact authority. */
export function executeAuthorizedEvryRead(
  registration: EvryReadRegistration,
  authorization: EvryReadCapabilityAuthorization,
  context: EvryReadInvocationContext,
  untrustedInput: unknown
): Promise<EvryReadContinuationArtifact | null> {
  if (authorization.registration.identity !== registration.capabilityIdentity) {
    return Promise.resolve(null);
  }
  return registration[EVRY_AUTHORIZED_READ_RUN](
    { ...context, authorization },
    untrustedInput
  );
}

/**
 * Bind one closed read id to its authoritative inventory identity and schema.
 * The selector can choose the id and input, but it cannot replace either rule.
 */
export function defineEvryReadRegistration<Shape extends z.ZodRawShape>({
  id,
  capabilityIdentity,
  inputShape,
  run,
}: {
  id: string;
  capabilityIdentity: string;
  inputShape: Shape;
  run: (
    context: EvryReadExecutionContext,
    input: z.infer<z.ZodObject<Shape>>
  ) => Promise<EvryReadContinuationArtifact>;
}): EvryReadRegistration {
  const inputSchema = z.object(inputShape).strict();

  const runAuthorized = async (
    context: EvryReadExecutionContext,
    untrustedInput: unknown
  ) => {
    const parsed = inputSchema.safeParse(untrustedInput);
    return parsed.success ? run(context, parsed.data) : null;
  };

  return Object.freeze({
    id,
    capabilityIdentity,
    async execute(context, untrustedInput) {
      const parsed = inputSchema.safeParse(untrustedInput);
      if (!parsed.success) return null;
      const authorization =
        await authorizeEvryReadCapability(capabilityIdentity);
      if (!authorization) return null;
      return run({ ...context, authorization }, parsed.data);
    },
    [EVRY_AUTHORIZED_READ_RUN]: runAuthorized,
    [EVRY_READ_REGISTRATION]: true as const,
  });
}

export type EvryReadSelection = Readonly<{
  readId: string;
  input: unknown;
}>;

export type EvryReadSelectorContext = Readonly<{
  literalUserText: string;
  pageContext: EvryPageContext | null;
  eligibleReadIds: readonly string[];
}>;

export type EvryReadSelector = (
  context: EvryReadSelectorContext
) => Promise<EvryReadSelection | null>;

export type EvryReadContinuationContext = Readonly<{
  eligibleCapabilities: readonly EvryCapabilityRegistration[];
  literalUserText: string;
  pageContext: EvryPageContext | null;
}>;

export type EvryReadContinuation = (
  context: EvryReadContinuationContext
) => Promise<EvryReadContinuationArtifact | null>;
