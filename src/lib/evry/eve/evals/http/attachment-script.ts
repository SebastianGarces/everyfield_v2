import type { z } from "zod";

type Json = z.infer<ReturnType<typeof z.json>>;

/** Scripted fixture arguments only. Do not interpolate source code or free text. */
export function resolveScriptedAttachmentInput(
  input: Json | undefined,
  attachmentId: string | undefined,
  messages: readonly { text: string }[]
): Json | undefined {
  function replace(value: Json): Json {
    if (value === "$attachment:0") {
      if (
        !attachmentId ||
        !messages.some(({ text }) => text.includes(attachmentId))
      )
        throw new Error(
          "Scripted attachment binding was not visible to the model"
        );
      return attachmentId;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, replace(item)])
      );
    return value;
  }
  return input === undefined ? undefined : replace(input);
}

/** Never include a signed upload reference in a fixture result or failure message. */
export function fixtureAttachmentReferencesHidden(
  value: unknown,
  references: readonly string[]
): boolean {
  const serialized = JSON.stringify(value) ?? "";
  return references.every(
    (reference) =>
      reference.length > 0 &&
      !serialized.includes(JSON.stringify(reference).slice(1, -1))
  );
}
