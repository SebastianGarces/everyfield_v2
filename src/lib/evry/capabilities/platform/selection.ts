import { feedbackCreateSchema } from "@/lib/validations/feedback";
import { z } from "zod";

export type PlatformEvrySelection =
  | Readonly<{ kind: "dashboard" }>
  | Readonly<{ kind: "notification_count" }>
  | Readonly<{
      kind: "notifications";
      unreadOnly: boolean;
      before: Readonly<{ createdAt: string; id: string }> | null;
    }>
  | Readonly<{ kind: "mark_one"; notificationId: string }>
  | Readonly<{ kind: "mark_all" }>
  | Readonly<{
      kind: "feedback";
      category: "bug" | "suggestion" | "question" | "other";
      description: string;
      pageUrl: string | null;
    }>;

const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

function classifiedText(value: string) {
  const literal = value.trim();
  let normalized = "";
  const boundaries: number[] = [0];
  let literalOffset = 0;
  for (const character of literal) {
    const classified = character.normalize("NFKC");
    for (let index = 0; index < classified.length; index += 1) {
      boundaries[normalized.length + index] = literalOffset;
    }
    normalized += classified;
    literalOffset += character.length;
    boundaries[normalized.length] = literalOffset;
  }
  return { literal, normalized, boundaries };
}

/** Closed command selection; normalization classifies only, payload stays literal. */
export function selectPlatformEvryRequest(
  input: string
): PlatformEvrySelection | null {
  const value = classifiedText(input);
  const { literal, normalized } = value;
  if (/^show dashboard summary[.!?]*$/i.test(normalized)) {
    return { kind: "dashboard" };
  }
  if (/^show unread notification count[.!?]*$/i.test(normalized)) {
    return { kind: "notification_count" };
  }
  if (/^show notifications[.!?]*$/i.test(normalized)) {
    return { kind: "notifications", unreadOnly: false, before: null };
  }
  if (/^show unread notifications[.!?]*$/i.test(normalized)) {
    return { kind: "notifications", unreadOnly: true, before: null };
  }
  const page = new RegExp(
    `^show (unread )?notifications before ([^|\\s]+)\\|(${UUID})[.!?]*$`,
    "i"
  ).exec(normalized);
  const timestamp = page?.[2]
    ? z.iso.datetime({ offset: true }).safeParse(page[2])
    : null;
  if (timestamp?.success && page?.[3]) {
    return {
      kind: "notifications",
      unreadOnly: Boolean(page[1]),
      before: {
        createdAt: new Date(timestamp.data).toISOString(),
        id: page[3].toLowerCase(),
      },
    };
  }
  const one = new RegExp(`^mark notification (${UUID}) read[.!?]*$`, "i").exec(
    normalized
  );
  if (one?.[1]) {
    return { kind: "mark_one", notificationId: one[1].toLowerCase() };
  }
  if (/^mark all notifications read[.!?]*$/i.test(normalized)) {
    return { kind: "mark_all" };
  }

  const prefix = /^submit feedback\s+/i.exec(normalized);
  if (!prefix) return null;
  const payloadStart = value.boundaries[prefix[0].length];
  if (payloadStart === undefined) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(literal.slice(payloadStart));
  } catch {
    return null;
  }
  const parsed = feedbackCreateSchema.safeParse(raw);
  return parsed.success
    ? {
        kind: "feedback",
        category: parsed.data.category,
        description: parsed.data.description,
        pageUrl: parsed.data.pageUrl || null,
      }
    : null;
}
