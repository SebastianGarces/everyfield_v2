import { z } from "zod";
import { peopleHistoryQuerySchema } from "../../capabilities/queries/people-query-sql";
import { evryConversationArtifactDocumentSchema } from "../../conversations/artifacts";

/** Structured scope only. Literal search is not semantic note classification. */
export const historyCollectionInputSchema = peopleHistoryQuerySchema.omit({
  text: true,
  result: true,
  contentOffset: true,
});
const readItem =
  evryConversationArtifactDocumentSchema.options[0].unwrap().shape.items
    .element;
const record = z.strictObject({
  item: readItem,
  notes: z.string(),
  contentComplete: z.boolean(),
  totalCharacters: z.number().int().nonnegative().nullable(),
  resultReferences: z.array(z.string().min(1)),
});
const evidence = {
  scope: historyCollectionInputSchema,
  matched: z.number().int().nonnegative().nullable(),
  records: z.array(record),
  readCount: z.number().int().nonnegative(),
  snapshot: z.literal("multiple_reads"),
};
export const historyCollectionOutputSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("complete"),
    ...evidence,
    matched: z.number().int().nonnegative(),
    records: z.array(
      record.extend({
        contentComplete: z.literal(true),
        totalCharacters: z.number().int().nonnegative(),
      })
    ),
  }),
  z.strictObject({
    status: z.literal("partial"),
    reason: z.enum([
      "read_unavailable",
      "continuation_unavailable",
      "evidence_changed",
    ]),
    ...evidence,
  }),
]);
export type HistoryCollectionInput = z.input<
  typeof historyCollectionInputSchema
>;
export type HistoryCollectionOutput = z.infer<
  typeof historyCollectionOutputSchema
>;

// Authored JavaScript runs inside the SAME isolate as the caller. Capturing the
// existing bridge adds no host authority, nested runner or separate budget.
// Keep it literal: function.toString() is not stable across the production build.
const helper = String.raw`
const history = ((read) => Object.freeze({collect: async (input) => {
  const allowed = HISTORY_ALLOWED_KEYS;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !allowed.includes(key)))
    throw new Error('history.collect requires structured history filters only.');
  const scope = JSON.parse(JSON.stringify(input));
  const records = new Map();
  let matched = null, readCount = 0;
  const outcome = (reason) => ({
    status: reason ? 'partial' : 'complete', ...(reason ? {reason} : {}),
    scope, matched, records: [...records.values()].map(({nextOffset, signature, ...record}) => record),
    readCount, snapshot: 'multiple_reads'
  });
  const chunkLabels = ['Recorded notes','Change reason','Notes character count','Notes character offset','Next content offset'];
  const stableItem = item => ({...item, facts:item.facts.filter(f => !chunkLabels.includes(f.label))});
  const decode = (page, offset) => {
    if (!page || page.kind !== 'read' || page.resultMode !== 'list' ||
        !page.continuation || page.continuation.status !== 'available' ||
        !Array.isArray(page.items) || !Array.isArray(page.continuation.records) ||
        page.items.length !== page.continuation.records.length ||
        !Number.isSafeInteger(page.counts?.matched) || page.counts.matched < 0 ||
        typeof page.resultReference !== 'string' || !page.resultReference)
      return {reason:'continuation_unavailable'};
    const ids = new Set();
    const decoded = [];
    for (const item of page.items) {
      if (ids.has(item.id)) return {reason:'evidence_changed'};
      ids.add(item.id);
      const entries = page.continuation.records.filter(r => r.id === item.id);
      if (entries.length !== 1) return {reason:'continuation_unavailable'};
      const c = entries[0].content;
      const chunks = item.facts.filter(f => f.label === 'Recorded notes' || f.label === 'Change reason');
      if (c.status !== 'available' || chunks.length !== 1 || c.offset !== offset ||
          !Number.isSafeInteger(c.totalCharacters) || c.totalCharacters < 0)
        return {reason:'continuation_unavailable'};
      const notes = chunks[0].value;
      const length = Array.from(notes).length;
      if (length !== (c.nextOffset ?? c.totalCharacters)-offset || offset > c.totalCharacters ||
          (c.nextOffset === null ? offset+length !== c.totalCharacters :
           c.nextOffset !== offset+length || c.nextOffset <= offset || c.nextOffset >= c.totalCharacters))
        return {reason:'continuation_unavailable'};
      const stable = stableItem(item);
      decoded.push({item:stable, notes, totalCharacters:c.totalCharacters,
        nextOffset:c.nextOffset, contentComplete:c.nextOffset === null,
        signature:JSON.stringify(stable), resultReferences:[page.resultReference]});
    }
    return {decoded};
  };
  const query = async (input) => {
    readCount++;
    try { return await read(input); } catch { return null; }
  };
  let afterId;
  do {
    const page = await query({...scope,result:{mode:'list',limit:50,...(afterId ? {afterId} : {})}});
    if (!page || page.status === 'unavailable') return outcome('read_unavailable');
    const decoded = decode(page,0);
    if (decoded.reason) return outcome(decoded.reason);
    if (matched !== null && matched !== page.counts.matched) return outcome('evidence_changed');
    matched = page.counts.matched;
    const next = page.continuation.nextAfterId;
    if ((next !== null && (typeof next !== 'string' || next !== page.items.at(-1)?.id || page.items.length !== 50)) ||
        page.items.some((item,i) => (afterId && item.id <= afterId) || (i && item.id <= page.items[i-1].id)))
      return outcome('evidence_changed');
    for (const record of decoded.decoded) {
      if (records.has(record.item.id)) return outcome('evidence_changed');
      records.set(record.item.id,record);
    }
    if (records.size > matched) return outcome('evidence_changed');
    afterId = next;
  } while (afterId !== null);
  if (records.size !== matched) return outcome('evidence_changed');
  while ([...records.values()].some(r => !r.contentComplete)) {
    const first = [...records.values()].find(r => !r.contentComplete);
    const batch = [...records.values()].filter(r => r.nextOffset === first.nextOffset).slice(0,50);
    const recordIds = batch.map(r => r.item.id);
    const page = await query({...scope,recordIds,contentOffset:first.nextOffset,result:{mode:'list',limit:50}});
    if (!page || page.status === 'unavailable') return outcome('read_unavailable');
    const decoded = decode(page,first.nextOffset);
    if (decoded.reason) return outcome(decoded.reason);
    if (page.counts.matched !== batch.length || page.continuation.nextAfterId !== null ||
        decoded.decoded.length !== batch.length || decoded.decoded.some(r => !recordIds.includes(r.item.id)))
      return outcome('evidence_changed');
    for (const chunk of decoded.decoded) {
      const original = records.get(chunk.item.id);
      if (chunk.signature !== original.signature || chunk.totalCharacters !== original.totalCharacters)
        return outcome('evidence_changed');
    }
    for (const chunk of decoded.decoded) {
      const original = records.get(chunk.item.id);
      original.notes += chunk.notes;
      original.nextOffset = chunk.nextOffset;
      original.contentComplete = chunk.contentComplete;
      original.resultReferences.push(...chunk.resultReferences);
    }
  }
  return outcome();
}}))(tools['people.history.query']);
return await (async () => {
`.replace(
  "HISTORY_ALLOWED_KEYS",
  JSON.stringify(Object.keys(historyCollectionInputSchema.shape))
);
const suffix = "\n})();";

export const HISTORY_HELPER_SOURCE_BYTES = Buffer.byteLength(helper + suffix);
/** Caller source is independently bounded before adding this fixed trusted code. */
export function withHistoryCollection(js: string) {
  return helper + js + suffix;
}
