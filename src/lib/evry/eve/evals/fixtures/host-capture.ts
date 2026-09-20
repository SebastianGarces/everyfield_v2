import assert from "node:assert/strict";
import { z } from "zod";

export type CapturedCall = {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
};
export type FixtureHostCapture = {
  calls: CapturedCall[];
  presented: string[];
  freshAuthorizations: number;
  refusedAuthorizations: number;
  outboundMessages: number;
  costUsd: number;
  costBasis: "provider_usage" | "reserved_upper_bound";
};
export const capturedReadArtifactSchema = z.object({
  kind: z.literal("read"),
  counts: z.object({ matched: z.number() }),
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      facts: z
        .array(z.object({ label: z.string(), value: z.string() }))
        .optional(),
    })
  ),
});

/** Only the private host journal supplies this input; never parse model or browser data here. */
export function parseFixtureHostCapture(input: unknown): FixtureHostCapture {
  const capture = z
    .object({
      calls: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          input: z.unknown(),
          output: z.unknown(),
        })
      ),
      presented: z.array(z.string().min(1)),
      freshAuthorizations: z.number().int().nonnegative(),
      refusedAuthorizations: z.number().int().nonnegative(),
      outboundMessages: z.number().int().nonnegative(),
      costUsd: z.number().finite().nonnegative(),
      costBasis: z.enum(["provider_usage", "reserved_upper_bound"]),
    })
    .parse(input);
  const calls = new Map(capture.calls.map((call) => [call.id, call]));
  assert.equal(calls.size, capture.calls.length, "Duplicate host tool call ID");
  for (const reference of capture.presented) {
    const call = calls.get(reference);
    assert.ok(
      call &&
        (capturedReadArtifactSchema.safeParse(call.output).success ||
          (call.name === "actions.prepare" &&
            z
              .object({
                artifacts: z
                  .array(z.object({ kind: z.literal("confirmation") }))
                  .min(1),
              })
              .safeParse(call.output).success)),
      "Untrusted host present_result reference"
    );
  }
  return capture;
}
