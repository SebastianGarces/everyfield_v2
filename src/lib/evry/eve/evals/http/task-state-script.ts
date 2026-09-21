import { z } from "zod";

/** Scripted provider only. Expected values verify observed state; they never supply it. */
export const taskPreparationAssertionSchema = z.strictObject({
  callId: z.string().min(1),
  draftCallId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  expectedFacts: z
    .record(z.string().max(100), z.string().max(4_000))
    .refine((facts) => Object.keys(facts).length <= 80),
});
const taskStateSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  goal: z.string(),
  facts: z.array(
    z.strictObject({
      key: z.string(),
      value: z.string(),
      source: z.enum(["user", "record", "inferred"]),
    })
  ),
  selectedRecords: z.array(
    z.strictObject({ kind: z.string(), id: z.string(), label: z.string() })
  ),
  pendingQuestion: z.string().nullable(),
});

export function assertObservedTask(
  assertion: Omit<z.infer<typeof taskPreparationAssertionSchema>, "callId">,
  toolResults: readonly {
    id: string;
    name: string;
    output: unknown;
    isError: boolean;
  }[]
) {
  const read = toolResults
    .filter((result) => result.name === "draft_get")
    .at(-1);
  if (!read || read.id !== assertion.draftCallId || read.isError)
    throw new Error("Fixture requires the current successful draft_get result");
  const state = taskStateSchema.parse(read.output);
  if (state.revision !== assertion.expectedRevision)
    throw new Error("Fixture observed a stale task revision");
  const values = Object.fromEntries(
    state.facts.map(({ key, value }) => [key, value])
  );
  if (Object.keys(values).length !== state.facts.length)
    throw new Error("Fixture observed duplicate task fact keys");
  for (const [key, value] of Object.entries(assertion.expectedFacts)) {
    if (values[key] !== value)
      throw new Error(`Fixture retained task fact mismatch: ${key}`);
  }
  return {
    values,
    observed: {
      draftCallId: read.id,
      revision: state.revision,
      factKeys: Object.keys(values).sort(),
    },
  };
}

export function preparationFromObservedTask(
  assertion: z.infer<typeof taskPreparationAssertionSchema>,
  toolResults: Parameters<typeof assertObservedTask>[1]
) {
  const { values, observed } = assertObservedTask(assertion, toolResults);
  const facts = z
    .object({
      meetingType: z.literal("orientation"),
      title: z.string().min(1),
      date: z.iso.date(),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      durationMinutes: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().positive()),
      locationId: z.uuid(),
      audience: z.literal("core_team"),
      subject: z.string().min(1),
      body: z.string().min(1),
      timezone: z.string().min(1),
    })
    .parse(values);
  return {
    observed,
    toolCall: {
      id: assertion.callId,
      name: "actions_prepare",
      input: {
        request: {
          operation: "recipe.meeting-invite",
          arguments: {
            meetingType: facts.meetingType,
            title: facts.title,
            dateTime: { date: facts.date, time: facts.time },
            durationMinutes: facts.durationMinutes,
            locationId: facts.locationId,
            audience: facts.audience,
            subject: facts.subject,
            body: facts.body,
          },
        },
      },
    },
  };
}

/** Match Eve's actual framework summary request, not ordinary conversation text. */
export function isScriptedCompactionRequest(request: {
  messages: readonly { role: string; text: string }[];
  tools: readonly unknown[];
}) {
  return (
    request.tools.length === 0 &&
    request.messages.some(
      (message) =>
        message.role === "system" &&
        message.text.startsWith(
          "You are performing a CONTEXT CHECKPOINT COMPACTION."
        )
    )
  );
}
