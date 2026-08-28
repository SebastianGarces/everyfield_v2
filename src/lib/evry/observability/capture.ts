import { parseEvryTraceDocument, type EvryTraceDocument } from "./contract";
import type { EvryTraceSink } from "./recorder";

export type EvryMemoryTraceSink = EvryTraceSink &
  Readonly<{
    traces: readonly EvryTraceDocument[];
  }>;

/** A deterministic sink for contract and integration fixtures. */
export function createEvryMemoryTraceSink(): EvryMemoryTraceSink {
  const traces: EvryTraceDocument[] = [];
  return {
    traces,
    async capture(trace) {
      traces.push(Object.freeze(parseEvryTraceDocument(trace)));
    },
  };
}
