import { defineState } from "eve/context";

type Claim = { turnId: string; callId: string };
const gate = defineState<Claim | null>(
  "evry.preparation-in-flight",
  () => null
);

export function mayClaimPreparation(
  current: Claim | null,
  next: Claim
): boolean {
  return (
    current === null ||
    current.turnId !== next.turnId ||
    current.callId === next.callId
  );
}

/** Serializes preparation, not reads. Invalid inputs never take this gate. */
export async function withPreparationGate<T>(
  claim: Claim,
  work: () => Promise<T>
): Promise<T | { status: "unavailable"; reason: "preparation_in_progress" }> {
  let acquired = false;
  gate.update((current) => {
    acquired = mayClaimPreparation(current, claim);
    return acquired ? claim : current;
  });
  if (!acquired)
    return { status: "unavailable", reason: "preparation_in_progress" };
  try {
    return await work();
  } finally {
    gate.update((current) =>
      current?.callId === claim.callId && current.turnId === claim.turnId
        ? null
        : current
    );
  }
}
