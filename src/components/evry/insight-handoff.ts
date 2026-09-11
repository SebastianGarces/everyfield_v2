import { z } from "zod";

import { safeEvryPageContextLabel } from "@/lib/evry/resolvers/contract";

import type { VisibleEvryPageContext } from "./page-context";

/**
 * Browser-only context for opening Evry from one Plant Intelligence insight.
 *
 * The contract has no place for an intent, capability, tool, confirmation, or
 * effect argument. The server receives only the source id and resolves it
 * again inside the authenticated plant before the conversation can use it.
 */
export const evryInsightHandoffSchema = z
  .object({
    source: z
      .object({
        kind: z.literal("plant_insight"),
        id: z.string().uuid(),
      })
      .strict(),
    display: z
      .object({
        label: z.string().trim().min(1).max(160),
      })
      .strict(),
  })
  .strict();

export type EvryInsightHandoff = z.infer<typeof evryInsightHandoffSchema>;

export function evryInsightHandoffFor(input: {
  insightId: string;
  title: string;
}): EvryInsightHandoff {
  return evryInsightHandoffSchema.parse({
    source: { kind: "plant_insight", id: input.insightId },
    display: {
      label: safeEvryPageContextLabel(
        `Observation: ${input.title}`,
        "Plant Intelligence observation"
      ),
    },
  });
}

/** Refuse forged or widened handoffs before they can change shell state. */
export function visibleEvryInsightHandoff(
  input: unknown
): VisibleEvryPageContext | null {
  const parsed = evryInsightHandoffSchema.safeParse(input);
  if (!parsed.success) return null;

  return {
    key: `${parsed.data.source.kind}:${parsed.data.source.id}`,
    label: parsed.data.display.label,
    wire: {
      kind: parsed.data.source.kind,
      recordId: parsed.data.source.id,
    },
  };
}
