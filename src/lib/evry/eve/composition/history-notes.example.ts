import { z } from "zod";
import { peopleHistoryQuerySchema } from "../../capabilities/queries/people-query-sql";
import { COMPOSITION_LIMITS } from "./runner";

/** Executable cookbook example only. Not registered as an agent tool. */
export function historyNotesExample(
  input: z.input<typeof peopleHistoryQuerySchema>
): string {
  const base = peopleHistoryQuerySchema.parse(input);
  if (
    base.result.mode !== "list" ||
    base.result.afterId !== undefined ||
    (base.contentOffset !== undefined && base.contentOffset !== 0)
  )
    throw new Error("The example starts at the first record and note page.");
  return `
const base = ${JSON.stringify(base)};
const maxCalls = ${COMPOSITION_LIMITS.maxBridgeRequests};
const records = new Map();
const references = [];
let calls = 0;
let cursor;
let total;
const value = (facts, label) => facts.find(f => f.label === label)?.value;
const noteLabels = new Set(['Recorded notes', 'Notes character count', 'Notes character offset', 'Next content offset']);
const stable = item => JSON.stringify({label:item.label, sourceLink:item.sourceLink, facts:item.facts.filter(f => !noteLabels.has(f.label))});
const finish = (complete, reason) => ({complete, ...(reason ? {reason} : {}), records:[...records.values()], references, ...(cursor ? {nextPageCursor:cursor} : {})});
const read = async input => {
  calls++;
  const result = await tools['people.history.query'](input);
  if (result.kind !== 'read' || result.resultMode !== 'list' || !Array.isArray(result.items)) return null;
  if (typeof result.resultReference === 'string') references.push(result.resultReference);
  return result;
};
const chunk = item => {
  const length = Number(value(item.facts, 'Notes character count'));
  const offset = Number(value(item.facts, 'Notes character offset'));
  const rawNext = value(item.facts, 'Next content offset');
  const next = rawNext === undefined ? null : Number(rawNext);
  const text = value(item.facts, 'Recorded notes') ?? '';
  const size = Array.from(text).length;
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset) || offset < 0 || offset + size > length) return null;
  if (next === null ? offset + size !== length : !Number.isSafeInteger(next) || next <= offset || next !== offset + size || next >= length) return null;
  return {length, offset, next, text};
};
// Record pagination and note offsets are separate. Never copy a page cursor
// into an exact-record continuation, or discard the original cohort/date basis.
while (true) {
  if (calls === maxCalls) return finish(false, 'call_limit');
  const page = await read({...base, result:{...base.result, ...(cursor ? {afterId:cursor} : {})}});
  if (!page) return finish(false, 'unavailable');
  if (!Number.isSafeInteger(page.counts?.matched) || page.counts.matched < 0 || (total !== undefined && total !== page.counts.matched)) return finish(false, 'changed');
  total = page.counts.matched;
  for (const item of page.items) {
    const part = chunk(item);
    if (!part || part.offset !== 0 || records.has(item.id)) return finish(false, 'changed');
    records.set(item.id, {id:item.id, label:item.label, sourceLink:item.sourceLink, facts:item.facts.filter(f => !noteLabels.has(f.label)), notes:part.text, length:part.length, nextOffset:part.next});
  }
  const next = value(page.filters, 'Next page cursor');
  if (next === 'End of results') { cursor = undefined; break; }
  if (typeof next !== 'string' || page.items.length === 0 || next !== page.items.at(-1).id || next === cursor) return finish(false, 'changed');
  cursor = next;
}
if (records.size !== total) return finish(false, 'changed');
while (true) {
  const pending = [...records.values()].filter(record => record.nextOffset !== null);
  if (pending.length === 0) return finish(true);
  if (calls === maxCalls) return finish(false, 'call_limit');
  const offset = pending[0].nextOffset;
  const batch = pending.filter(record => record.nextOffset === offset).slice(0, 50);
  const ids = batch.map(record => record.id);
  const page = await read({...base, recordIds:ids, contentOffset:offset, result:{mode:'list', limit:50}});
  if (!page) return finish(false, 'unavailable');
  if (page.counts?.matched !== ids.length || page.items.length !== ids.length || value(page.filters, 'Next page cursor') !== 'End of results' || new Set(page.items.map(item => item.id)).size !== ids.length) return finish(false, 'changed');
  const updates = [];
  for (const item of page.items) {
    if (!ids.includes(item.id)) return finish(false, 'changed');
    const record = records.get(item.id);
    const part = chunk(item);
    if (!part || part.offset !== record.nextOffset || part.length !== record.length || stable(item) !== stable(record)) return finish(false, 'changed');
    updates.push({record, part});
  }
  for (const {record, part} of updates) {
    record.notes += part.text;
    record.nextOffset = part.next;
  }
}
`;
}
