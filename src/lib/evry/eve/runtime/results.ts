import { defineState } from "eve/context";
import { z } from "zod";
import { publicEvryArtifact } from "../../artifacts/public";
import {
  parseEvryConversationArtifactDocument,
  hydrateStoredEvryConversationArtifact,
} from "../../conversations/artifacts";
import type { EveJsonValue } from "../capabilities/registry";
import { eveResultPresentationSchema } from "../presentation";

type ResultRecord = {
  reference: string;
  turnId: string;
  capability: string;
  artifacts: EveJsonValue[];
};
export const evryResultState = defineState<ResultRecord[]>(
  "evry.authorized-results",
  () => []
);

/** Project at presentation time, including results saved by older agent builds. */
export function publicResultArtifacts(artifacts: readonly EveJsonValue[]) {
  return artifacts.map((artifact) =>
    z
      .json()
      .parse(
        publicEvryArtifact(
          hydrateStoredEvryConversationArtifact(
            parseEvryConversationArtifactDocument(artifact)
          )
        )
      )
  );
}

/** Only the authenticated registry wrapper writes this state; model task notes cannot. */
export function collectResult(
  records: ResultRecord[],
  entry: Omit<ResultRecord, "artifacts">,
  result: EveJsonValue
): ResultRecord[] {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return records;
  const artifacts =
    result.kind === "read" || result.kind === "clarification"
      ? [result]
      : entry.capability === "actions.prepare" &&
          Array.isArray(result.artifacts)
        ? result.artifacts
        : [];
  if (artifacts.length === 0) return records;
  const next = [
    ...records.filter(
      (item) =>
        item.turnId === entry.turnId && item.reference !== entry.reference
    ),
    { ...entry, artifacts },
  ].slice(-24);
  while (JSON.stringify(next).length > 1_000_000) next.shift();
  return next;
}

export function findResult(
  records: ResultRecord[],
  reference: string,
  turnId: string
): ResultRecord | undefined {
  return records.find(
    (item) => item.reference === reference && item.turnId === turnId
  );
}

/** Native executors own this envelope; generated code can only populate data. */
export function withResultPresentation(
  data: unknown,
  turnId: string,
  references: readonly string[]
) {
  const selected = new Set(references);
  return {
    // Match the native JSON transport, which drops undefined object properties.
    data: z.json().parse(JSON.parse(JSON.stringify(data))),
    presentation: eveResultPresentationSchema.parse({
      version: 1,
      turnId,
      results: evryResultState
        .get()
        .filter(
          (record) => record.turnId === turnId && selected.has(record.reference)
        )
        .map((record) => ({
          reference: record.reference,
          artifacts: publicResultArtifacts(record.artifacts),
        })),
    }),
  };
}
