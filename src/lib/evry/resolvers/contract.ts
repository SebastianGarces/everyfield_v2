import { z } from "zod";

import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";

import type {
  EvryArtifactFact,
  EvryClarificationArtifact,
  EvryEntityChoice,
  TrustedEvryApplicationSourceLink,
} from "../artifacts/types";

export const EVRY_PAGE_CONTEXT_KINDS = [
  "person",
  "meeting",
  "team",
  "task",
  "launch",
  "plant_intelligence",
] as const;

/** Page context names a record hint. Plant and permission are not wire fields. */
export const evryPageContextSchema = z
  .object({
    kind: z.enum(EVRY_PAGE_CONTEXT_KINDS),
    recordId: z.string().min(1).max(160),
  })
  .strict();

export type EvryPageContext = z.infer<typeof evryPageContextSchema>;

/** A page-context hint after the server has scoped it and named the row. */
export const evryResolvedPageContextSchema = z
  .object({
    kind: z.enum(EVRY_PAGE_CONTEXT_KINDS),
    recordId: z.string().min(1).max(160),
    label: z.string().trim().min(1).max(160),
  })
  .strict();

export type EvryResolvedPageContext = z.infer<
  typeof evryResolvedPageContextSchema
>;

export function safeEvryPageContextLabel(
  value: string,
  fallback: string
): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  const clipped = (normalized || fallback).slice(0, 160);
  const lastCodeUnit = clipped.charCodeAt(clipped.length - 1);
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
    ? clipped.slice(0, -1)
    : clipped;
}

const LEGACY_PAGE_CONTEXT_LABELS = {
  person: "Person record",
  meeting: "Meeting record",
  team: "Team record",
  task: "Task record",
  launch: "Launch record",
  plant_intelligence: "Plant Intelligence assessment",
} as const satisfies Record<(typeof EVRY_PAGE_CONTEXT_KINDS)[number], string>;

/**
 * Read both the server-labeled shape and #763's exact label-free shape.
 * Legacy rows receive fixed copy; no client-owned display text is upgraded.
 */
export const evryStoredPageContextSchema = z.union([
  evryResolvedPageContextSchema,
  evryPageContextSchema.transform((context) => ({
    ...context,
    label: LEGACY_PAGE_CONTEXT_LABELS[context.kind],
  })),
]);

export type EvryResolverCandidate = Readonly<{
  id: string;
  match: "exact" | "fuzzy";
  label: string;
  distinguishingFacts: readonly EvryArtifactFact[];
  sourceLink: TrustedEvryApplicationSourceLink;
}>;

export type EvryEntityResolution =
  | Readonly<{ status: "resolved"; entity: EvryEntityChoice }>
  | Readonly<{
      status: "clarification";
      artifact: EvryClarificationArtifact;
    }>;

export type EvryResolverAdapter = (context: {
  authorization: EvryReadCapabilityAuthorization;
  referenceText: string;
  pageContext: EvryPageContext | null;
}) => Promise<readonly EvryResolverCandidate[]>;
