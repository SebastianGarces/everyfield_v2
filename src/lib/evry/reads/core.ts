import { isEvryReadCapabilityIdentity } from "@/lib/evry/eligibility/capabilities";

import type {
  EvryReadContinuation,
  EvryReadRegistration,
  EvryReadSelector,
} from "./contract";

function readRegistry(
  registrations: readonly EvryReadRegistration[]
): ReadonlyMap<string, EvryReadRegistration> {
  const registry = new Map<string, EvryReadRegistration>();
  for (const registration of registrations) {
    if (!isEvryReadCapabilityIdentity(registration.capabilityIdentity)) {
      continue;
    }
    if (registry.has(registration.id)) {
      throw new Error(`Duplicate Evry read registration: ${registration.id}`);
    }
    registry.set(registration.id, registration);
  }
  return registry;
}

/**
 * Build the shared read continuation used by the request route.
 *
 * Selection sees only eligible read ids. The trusted registry resolves the
 * application's capability identity, which is reauthorized immediately before
 * the adapter receives it.
 */
export function createEvryReadContinuation({
  registrations,
  select,
}: {
  registrations: readonly EvryReadRegistration[];
  select: EvryReadSelector;
}): EvryReadContinuation {
  const registry = readRegistry(registrations);

  return async function continueEvryRead(context) {
    const eligibleCapabilityIdentities = new Set(
      context.eligibleCapabilities.map(({ identity }) => identity)
    );
    const eligibleReadIds = [...registry.values()]
      .filter(({ capabilityIdentity }) =>
        eligibleCapabilityIdentities.has(capabilityIdentity)
      )
      .map(({ id }) => id)
      .sort();

    const selection = await select({
      literalUserText: context.literalUserText,
      pageContext: context.pageContext,
      eligibleReadIds,
    });
    if (!selection || !eligibleReadIds.includes(selection.readId)) return null;

    const registration = registry.get(selection.readId);
    if (!registration) return null;

    return registration.execute(
      {
        literalUserText: context.literalUserText,
        pageContext: context.pageContext,
      },
      selection.input
    );
  };
}
