import {
  EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES,
  EVRY_PEOPLE_ATTACHMENT_MAX_CHUNKS,
  EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH,
} from "@/lib/evry/capabilities/people/attachment-contract";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export type PendingPeopleFileSubmission = Readonly<{
  semanticKey: string;
  requestKey: string;
}>;

export type PreparedEvryPeopleFile = Readonly<{
  reference: string;
  digest: string;
  duplicateRows: readonly Readonly<{
    rowNumber: number;
    label: string;
    mergeTarget: string;
  }>[];
}>;

export type PreparedEvryPeopleUpload = Readonly<{
  reference: string;
  chunkBytes: number;
  chunkCount: number;
}>;

type PlanIdentity = Readonly<{
  prepared: PreparedEvryPeopleFile;
  conversationId: string | null;
  requestKey: string;
}>;

export type EvryPeopleFilePlanInput =
  | (PlanIdentity &
      Readonly<{
        kind: "people_csv";
        duplicateResolutions: Readonly<
          Record<string, "skip" | "create" | "merge">
        >;
      }>)
  | (PlanIdentity & Readonly<{ kind: "person_photo" }>)
  | (PlanIdentity &
      Readonly<{
        kind: "commitment_document";
        commitmentType: "core_group" | "launch_team";
        signedDate: string;
        notes: string | null;
      }>);

/** Build the exact content- and option-bound plan request sent to the server. */
export function evryPeopleFilePlanBody(input: EvryPeopleFilePlanInput) {
  const identity = {
    kind: input.kind,
    reference: input.prepared.reference,
    attachmentDigest: input.prepared.digest,
    conversationId: input.conversationId,
    requestKey: input.requestKey,
  };
  if (input.kind === "people_csv") {
    return { ...identity, duplicateResolutions: input.duplicateResolutions };
  }
  if (input.kind === "commitment_document") {
    return {
      ...identity,
      commitmentType: input.commitmentType,
      signedDate: input.signedDate,
      witness: null,
      notes: input.notes,
    };
  }
  return identity;
}

export function pendingPeopleFileSubmissionFor(
  current: PendingPeopleFileSubmission | null,
  semanticKey: string,
  mintRequestKey: () => string
): PendingPeopleFileSubmission {
  return current?.semanticKey === semanticKey
    ? current
    : { semanticKey, requestKey: mintRequestKey() };
}

/** Read duplicate row keys only from the typed, network-delivered preview. */
export function duplicateRowNumbersFromPeopleStage(
  value: unknown
): readonly number[] {
  return duplicateRowsFromPeopleStage(value).map(({ rowNumber }) => rowNumber);
}

/** Read each duplicate row and its exact default merge target. */
export function duplicateRowsFromPeopleStage(value: unknown) {
  const staged = record(value);
  const artifact = record(staged?.artifact);
  if (staged?.status !== "staged" || artifact?.kind !== "read") return [];
  if (!Array.isArray(artifact.items)) return [];

  const rows = new Map<
    number,
    Readonly<{ rowNumber: number; label: string; mergeTarget: string }>
  >();
  for (const itemValue of artifact.items) {
    const item = record(itemValue);
    const match =
      typeof item?.id === "string" ? /^csv-row-(\d+)$/.exec(item.id) : null;
    if (!match || !Array.isArray(item?.facts)) continue;
    const isDuplicate = item.facts.some((factValue) => {
      const fact = record(factValue);
      return fact?.label === "Status" && fact.value === "Duplicate review";
    });
    const mergeTarget = item.facts.find((factValue) => {
      const fact = record(factValue);
      return fact?.label === "Merge target" && typeof fact.value === "string";
    });
    const mergeTargetValue = record(mergeTarget)?.value;
    const rowNumber = Number(match[1]);
    if (
      isDuplicate &&
      Number.isSafeInteger(rowNumber) &&
      rowNumber > 0 &&
      typeof item.label === "string" &&
      typeof mergeTargetValue === "string"
    ) {
      rows.set(rowNumber, {
        rowNumber,
        label: item.label,
        mergeTarget: mergeTargetValue,
      });
    }
  }
  return [...rows.values()].sort(
    (left, right) => left.rowNumber - right.rowNumber
  );
}

/** Accept only the signed reference and digest delivered by the staging API. */
export function preparedEvryPeopleFileFromStage(
  value: unknown
): PreparedEvryPeopleFile | null {
  const staged = record(value);
  const metadata = record(staged?.metadata);
  return staged?.status === "staged" &&
    typeof staged.reference === "string" &&
    staged.reference.length > 0 &&
    staged.reference.length <=
      EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH &&
    typeof metadata?.digest === "string" &&
    /^[0-9a-f]{64}$/.test(metadata.digest)
    ? {
        reference: staged.reference,
        digest: metadata.digest,
        duplicateRows: duplicateRowsFromPeopleStage(value),
      }
    : null;
}

/** Accept only a compact, bounded upload manifest delivered by the API. */
export function preparedEvryPeopleUploadFromResponse(
  value: unknown
): PreparedEvryPeopleUpload | null {
  const prepared = record(value);
  return prepared?.status === "prepared" &&
    typeof prepared.reference === "string" &&
    prepared.reference.length > 0 &&
    prepared.reference.length <=
      EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH &&
    typeof prepared.chunkBytes === "number" &&
    Number.isSafeInteger(prepared.chunkBytes) &&
    prepared.chunkBytes === EVRY_PEOPLE_ATTACHMENT_CHUNK_BYTES &&
    typeof prepared.chunkCount === "number" &&
    Number.isSafeInteger(prepared.chunkCount) &&
    prepared.chunkCount > 0 &&
    prepared.chunkCount <= EVRY_PEOPLE_ATTACHMENT_MAX_CHUNKS
    ? {
        reference: prepared.reference,
        chunkBytes: prepared.chunkBytes,
        chunkCount: prepared.chunkCount,
      }
    : null;
}
