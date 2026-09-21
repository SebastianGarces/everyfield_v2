import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { z } from "zod";

export const processingSnapshotSchema = z.strictObject({
  turnId: z.string().min(1),
  modelCalls: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
});

/** Fixture-only proof from completed native turnStep checkpoints, not observer memory. */
export async function readFixtureProcessingSnapshots(directory: string) {
  const events = join(directory, ".eve/.workflow-data/events");
  const snapshots = new Map<string, z.infer<typeof processingSnapshotSchema>>();
  for (const name of (await readdir(events))
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const event = z
      .object({
        eventType: z.literal("step_completed"),
        eventData: z.object({
          stepName: z.string().includes("//turnStep"),
          result: z.object({
            __type: z.literal("Uint8Array"),
            data: z.string(),
          }),
        }),
      })
      .safeParse(JSON.parse(await readFile(join(events, name), "utf8")));
    if (!event.success) continue;
    let bytes = Buffer.from(event.data.eventData.result.data, "base64");
    if (bytes.subarray(0, 4).toString() === "zstd")
      bytes = zstdDecompressSync(bytes.subarray(4));
    if (bytes.subarray(0, 4).toString() !== "devl") continue;
    // Resolve only this flat metadata record from Workflow's devalue reference table.
    const values: unknown = JSON.parse(bytes.subarray(4).toString());
    if (!Array.isArray(values)) continue;
    const result = z
      .object({ serializedContext: z.number().int().nonnegative() })
      .safeParse(values[0]);
    if (result.success) {
      const record = z
        .object({ "evry.processing-budget": z.number().int().nonnegative() })
        .safeParse(values[result.data.serializedContext]);
      if (!record.success) continue;
      const fields = z
        .record(z.string(), z.number().int().nonnegative())
        .safeParse(values[record.data["evry.processing-budget"]]);
      if (!fields.success) continue;
      const parsed = processingSnapshotSchema.safeParse(
        Object.fromEntries(
          Object.entries(fields.data).map(([key, index]) => [
            key,
            values[index],
          ])
        )
      );
      if (parsed.success)
        snapshots.set(JSON.stringify(parsed.data), parsed.data);
    }
  }
  return [...snapshots.values()];
}
