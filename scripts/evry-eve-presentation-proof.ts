import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import type { LanguageModelMiddleware } from "ai";
import { z } from "zod";

type Prompt = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"]["prompt"];
const strings = z.array(z.string().min(1).max(200)).max(64);
export const presentationAssertionSchema = z.strictObject({
  retired: strings,
  current: strings,
  preservedText: strings,
  userText: z.string().min(1).max(4_000),
});
export const presentationReceiptSchema = z.strictObject({
  retiredChecked: z.number().int().nonnegative(),
  currentChecked: z.number().int().nonnegative(),
  factsChecked: z.number().int().nonnegative(),
  userTextPreserved: z.literal(true),
});
export const presentationInventoryRequestSchema = strings.min(1);
export const presentationInventoryReceiptSchema = z.strictObject({
  matchingSnapshots: z.number().int().positive(),
  issuedCount: z.number().int().positive(),
  exactIssuedSet: z.literal(true),
});

/** Only the scripted provider calls this. Never export the inspected prompt. */
export function assertProviderPresentation(
  prompt: Prompt,
  expected: z.infer<typeof presentationAssertionSchema>
) {
  const evidence = prompt
    .flatMap((message) => {
      if (message.role === "user" || message.role === "system") return [];
      return message.content.flatMap((part) => {
        if (part.type === "text" || part.type === "reasoning")
          return [part.text];
        if (part.type === "tool-result" && part.toolName !== "actions_prepare")
          return [JSON.stringify(part.output)];
        if (part.type === "tool-call" && part.toolName === "code_mode")
          return [JSON.stringify(part.input)];
        return [];
      });
    })
    .join("\n");
  for (const reference of expected.retired) {
    const encoded = encodeURIComponent(reference);
    if (
      [
        reference,
        encoded,
        encoded.replace(/%[\dA-F]{2}/g, (hex) => hex.toLowerCase()),
      ].some((spelling) => evidence.includes(spelling))
    )
      throw new Error(
        "Retired presentation reference reached provider history"
      );
  }
  if (expected.current.some((reference) => !evidence.includes(reference)))
    throw new Error(
      "Current presentation reference missing from provider history"
    );
  if (expected.preservedText.some((text) => !evidence.includes(text)))
    throw new Error("Retained evidence missing from provider history");
  if (
    !prompt.some(
      (message) =>
        message.role === "user" &&
        message.content.some(
          (part) => part.type === "text" && part.text === expected.userText
        )
    )
  )
    throw new Error("Original user text changed at provider boundary");
  return presentationReceiptSchema.parse({
    retiredChecked: expected.retired.length,
    currentChecked: expected.current.length,
    factsChecked: expected.preservedText.length,
    userTextPreserved: true,
  });
}

/** Inspect native completed turnStep files, not the worker's in-memory state. */
export async function assertSavedPresentationInventory(
  directory: string,
  expected: readonly string[]
) {
  const events = join(directory, ".eve/.workflow-data/events");
  const snapshots: string[][] = [];
  for (const name of (await readdir(events)).filter((name) =>
    name.endsWith(".json")
  )) {
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
    const values: unknown = JSON.parse(bytes.subarray(4).toString());
    if (!Array.isArray(values)) continue;
    const root = z
      .object({ serializedContext: z.number().int().nonnegative() })
      .safeParse(values[0]);
    if (!root.success) continue;
    const state = z
      .object({
        "evry.issued-result-references": z.number().int().nonnegative(),
      })
      .safeParse(values[root.data.serializedContext]);
    if (!state.success) continue;
    const indexes = z
      .array(z.number().int().nonnegative())
      .parse(values[state.data["evry.issued-result-references"]]);
    snapshots.push(
      z.array(z.string()).parse(indexes.map((index) => values[index]))
    );
  }
  const wanted = new Set(expected);
  if (
    wanted.size !== expected.length ||
    snapshots.some(
      (refs) =>
        new Set(refs).size !== refs.length ||
        refs.some((ref) => !wanted.has(ref))
    )
  )
    throw new Error(
      "Saved presentation inventory contains an unexpected identity"
    );
  const matchingSnapshots = snapshots.filter(
    (refs) => refs.length === wanted.size
  ).length;
  if (matchingSnapshots === 0)
    throw new Error(
      "No completed native checkpoint contains the issued inventory"
    );
  return presentationInventoryReceiptSchema.parse({
    matchingSnapshots,
    issuedCount: wanted.size,
    exactIssuedSet: true,
  });
}
