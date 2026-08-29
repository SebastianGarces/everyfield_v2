import { z } from "zod";

import {
  publicEvryConversationSchema,
  type PublicEvryConversation,
} from "@/lib/evry/conversations/public-contract";
import type { EvryWorkState } from "@/lib/evry/streaming/state";

const requestIdSchema = z.string().uuid();
const sequencedEvent = {
  requestId: requestIdSchema,
  sequence: z.number().int().nonnegative(),
} as const;

const workStreamEventSchema = z.discriminatedUnion("code", [
  z
    .object({
      type: z.literal("work"),
      ...sequencedEvent,
      phase: z.literal("reading"),
      code: z.literal("request_accepted"),
    })
    .strict()
    .readonly(),
  z
    .object({
      type: z.literal("work"),
      ...sequencedEvent,
      phase: z.literal("planning"),
      code: z.enum([
        "resolving_references",
        "revalidating_plan",
        "compiling_response",
      ]),
    })
    .strict()
    .readonly(),
]);

export const evryConversationStreamEventSchema = z.union([
  workStreamEventSchema,
  z
    .object({
      type: z.literal("conversation"),
      ...sequencedEvent,
      conversation: publicEvryConversationSchema,
    })
    .strict()
    .readonly(),
  z
    .object({
      type: z.literal("complete"),
      ...sequencedEvent,
    })
    .strict()
    .readonly(),
  z
    .object({
      type: z.literal("active"),
      ...sequencedEvent,
    })
    .strict()
    .readonly(),
  z
    .object({
      type: z.literal("failure"),
      ...sequencedEvent,
      code: z.enum(["stale", "unavailable"]),
    })
    .strict()
    .readonly(),
]);

export type EvryConversationStreamEvent = z.infer<
  typeof evryConversationStreamEventSchema
>;
export type EvryConversationStreamWorkCode = Extract<
  EvryConversationStreamEvent,
  { type: "work" }
>["code"];
export type EvryConversationStreamStage = Exclude<
  EvryConversationStreamWorkCode,
  "request_accepted"
>;

export class EvryConversationStreamFailure extends Error {
  readonly code: "stale" | "unavailable";
  readonly durableConversationSeen: boolean;

  constructor(code: "stale" | "unavailable", durableConversationSeen: boolean) {
    super("Unable to update this conversation.");
    this.name = "EvryConversationStreamFailure";
    this.code = code;
    this.durableConversationSeen = durableConversationSeen;
  }
}

const WORK_MESSAGE: Readonly<
  Record<EvryConversationStreamWorkCode, EvryWorkState>
> = Object.freeze({
  request_accepted: {
    phase: "reading",
    message: "Checking this conversation",
  },
  resolving_references: {
    phase: "planning",
    message: "Resolving the people and records in your request",
  },
  revalidating_plan: {
    phase: "planning",
    message: "Checking that your pending plan is still current",
  },
  compiling_response: {
    phase: "planning",
    message: "Preparing the next useful step",
  },
});

export function evryWorkStateForStreamEvent(
  event: Extract<EvryConversationStreamEvent, { type: "work" }>
): EvryWorkState {
  return WORK_MESSAGE[event.code];
}

export type EvryConversationStreamResult =
  | Readonly<{
      conversation: PublicEvryConversation;
      sawComplete: true;
    }>
  | Readonly<{ status: "active" }>;

export async function readEvryConversationStream(
  response: Response,
  input: Readonly<{
    requestId: string;
    expectedConversationId: string | null;
    onEvent: (event: EvryConversationStreamEvent) => void;
  }>
): Promise<EvryConversationStreamResult> {
  const requestId = requestIdSchema.parse(input.requestId);
  if (!response.ok || !response.body) {
    throw new Error("Unable to update this conversation.");
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    throw new Error("Evry conversation stream was unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let expectedSequence = 0;
  let conversation: PublicEvryConversation | null = null;
  let sawComplete = false;
  let adoptedActive = false;
  let lifecycle: "awaiting_accept" | "working" | "conversation" | "complete" =
    "awaiting_accept";

  const acceptLine = (line: string) => {
    if (line.length === 0) return;
    const event = evryConversationStreamEventSchema.parse(JSON.parse(line));
    if (
      event.requestId !== requestId ||
      event.sequence !== expectedSequence ||
      lifecycle === "complete"
    ) {
      throw new Error("Evry conversation stream was out of sequence.");
    }
    expectedSequence += 1;
    if (lifecycle === "awaiting_accept") {
      if (
        event.type !== "work" ||
        event.code !== "request_accepted" ||
        event.sequence !== 0
      ) {
        throw new Error("Evry conversation stream omitted its acceptance.");
      }
      lifecycle = "working";
    } else if (lifecycle === "working") {
      if (event.type === "work" && event.code === "request_accepted") {
        throw new Error("Evry conversation stream repeated its acceptance.");
      }
      if (event.type === "conversation") lifecycle = "conversation";
      if (event.type === "active") {
        lifecycle = "complete";
        adoptedActive = true;
      }
      if (event.type === "complete") {
        throw new Error(
          "Evry conversation stream completed without durable output."
        );
      }
    } else if (lifecycle === "conversation") {
      if (event.type === "complete") {
        lifecycle = "complete";
        sawComplete = true;
      } else if (event.type !== "failure") {
        throw new Error(
          "Evry conversation stream continued after durable output."
        );
      }
    }
    if (event.type === "failure") {
      throw new EvryConversationStreamFailure(
        event.code,
        conversation !== null
      );
    }
    if (event.type === "conversation") {
      if (
        input.expectedConversationId !== null &&
        event.conversation.id !== input.expectedConversationId
      ) {
        throw new Error("Conversation response did not match its request.");
      }
      conversation = event.conversation;
    }
    if (event.type === "complete") {
      if (!conversation) {
        throw new Error("Evry conversation stream completed without output.");
      }
    }
    input.onEvent(event);
  };

  try {
    while (true) {
      const read = await reader.read();
      buffer += decoder.decode(read.value, { stream: !read.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) acceptLine(line);
      if (read.done) break;
    }
    if (buffer.length > 0) acceptLine(buffer);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  if (adoptedActive) return { status: "active" };
  if (!sawComplete || !conversation) {
    throw new Error("Evry conversation stream ended before completion.");
  }
  return { conversation, sawComplete: true };
}
