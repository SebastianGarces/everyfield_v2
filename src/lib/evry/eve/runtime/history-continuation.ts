import { z } from "zod";
import { peopleHistoryQuerySchema } from "../../capabilities/queries/people-query-sql";
import { evryConversationArtifactDocumentSchema } from "../../conversations/artifacts";
import type {
  EveJsonValue,
  EveToolDescription,
} from "../capabilities/registry";

const unavailable = z.strictObject({ status: z.literal("unavailable") });
const offset = peopleHistoryQuerySchema.shape.contentOffset.unwrap();
const contentSchema = z.discriminatedUnion("status", [
  unavailable,
  z.strictObject({
    status: z.literal("available"),
    offset,
    totalCharacters: z.number().int().nonnegative(),
    nextOffset: offset
      .nullable()
      .describe("Null only when this note has no remaining characters."),
  }),
]);
export const historyContinuationSchema = z.discriminatedUnion("status", [
  unavailable,
  z.strictObject({
    status: z.literal("available"),
    nextAfterId: z
      .uuid()
      .nullable()
      .describe(
        "Use as result.afterId with unchanged filters; null means the last record page."
      ),
    records: z
      .array(z.strictObject({ id: z.uuid(), content: contentSchema }))
      .max(50),
  }),
]);

const outputContract = JSON.stringify(
  z.toJSONSchema(historyContinuationSchema)
);

/** Describe the actual projected output, from its schema, on the selected tool. */
export function describeHistoryContinuation(
  entry: EveToolDescription
): EveToolDescription {
  return entry.name !== "people.history.query"
    ? entry
    : {
        ...entry,
        description: `${entry.description} List outputs include continuation with this JSON Schema: ${outputContract}. Record pagination and note continuation are independent. For notes, preserve base filters and required result settings, use exact recordIds and content.nextOffset as contentOffset; do not carry a record-page cursor into an exact-record read. Unavailable metadata never means complete.`,
      };
}

type Fact = { label: string; value: string; modelOnly?: boolean };
function one(facts: readonly Fact[], label: string, modelOnly = false) {
  const matches = facts.filter((fact) => fact.label === label);
  return matches.length === 1 && (!modelOnly || matches[0].modelOnly === true)
    ? matches[0].value
    : undefined;
}
function integer(value: string | undefined) {
  if (value === undefined || !/^(0|[1-9]\d*)$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}
function contentContinuation(
  facts: readonly Fact[],
  requestedOffset: number
): z.infer<typeof contentSchema> {
  const totalCharacters = integer(one(facts, "Notes character count", true));
  const start = integer(one(facts, "Notes character offset", true));
  const chunks = facts.filter(
    ({ label }) => label === "Recorded notes" || label === "Change reason"
  );
  const nextFacts = facts.filter(
    ({ label }) => label === "Next content offset"
  );
  if (
    totalCharacters === undefined ||
    start !== requestedOffset ||
    chunks.length !== 1
  )
    return { status: "unavailable" };
  const length = Array.from(chunks[0].value).length;
  if (length !== Math.min(240, Math.max(0, totalCharacters - start)))
    return { status: "unavailable" };
  const remaining = start + length < totalCharacters;
  if (!remaining && nextFacts.length === 0)
    return {
      status: "available",
      offset: start,
      totalCharacters,
      nextOffset: null,
    };
  const next = integer(one(facts, "Next content offset", true));
  if (!remaining || next !== start + length || !offset.safeParse(next).success)
    return { status: "unavailable" };
  return {
    status: "available",
    offset: start,
    totalCharacters,
    nextOffset: next,
  };
}

/** Model-only addition. Call after retaining the original authorized artifact. */
export function historyContinuationModelOutput(
  input: unknown,
  result: EveJsonValue
): EveJsonValue {
  const query = peopleHistoryQuerySchema.safeParse(input);
  if (
    !query.success ||
    query.data.result.mode !== "list" ||
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    result.kind !== "read"
  )
    return result;
  const parsed = evryConversationArtifactDocumentSchema.safeParse(result);
  const missing = () => ({
    ...result,
    continuation: { status: "unavailable" },
  });
  if (
    !parsed.success ||
    parsed.data.kind !== "read" ||
    parsed.data.resultMode !== "list"
  )
    return missing();
  const page = parsed.data;
  const { afterId, limit } = query.data.result;
  const ids = page.items.map(({ id }) => id);
  const cursor = one(page.filters, "Next page cursor");
  if (
    ids.length > limit ||
    ids.some(
      (id, index) =>
        !z.uuid().safeParse(id).success ||
        (index > 0 && id <= ids[index - 1]) ||
        (afterId !== undefined && id <= afterId)
    ) ||
    cursor === undefined ||
    (!afterId &&
      cursor === "End of results" &&
      page.counts.matched !== ids.length)
  )
    return missing();
  const nextAfterId = cursor === "End of results" ? null : cursor;
  if (
    nextAfterId !== null &&
    (!z.uuid().safeParse(nextAfterId).success ||
      nextAfterId !== ids.at(-1) ||
      ids.length !== limit ||
      page.counts.matched <= ids.length)
  )
    return missing();
  const continuation = historyContinuationSchema.parse({
    status: "available",
    nextAfterId,
    records: page.items.map((item) => ({
      id: item.id,
      content: contentContinuation(item.facts, query.data.contentOffset ?? 0),
    })),
  });
  return { ...result, continuation };
}
