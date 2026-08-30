import { createHash } from "node:crypto";

/** Stable database/provider identity derived only from the approved effect. */
export function communicationEvryEffectUuid(
  effectKey: string,
  purpose: string
): string {
  const digest = createHash("sha256")
    .update("evry-communication-effect-v1\0")
    .update(effectKey)
    .update("\0")
    .update(purpose)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "4";
  digest[16] = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16
  );
  return `${digest.slice(0, 8).join("")}-${digest
    .slice(8, 12)
    .join("")}-${digest.slice(12, 16).join("")}-${digest
    .slice(16, 20)
    .join("")}-${digest.slice(20).join("")}`;
}
