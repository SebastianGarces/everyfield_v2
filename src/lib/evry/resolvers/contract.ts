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
