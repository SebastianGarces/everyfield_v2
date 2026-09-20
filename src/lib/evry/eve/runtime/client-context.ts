import type { ModelMessage } from "ai";
import {
  evryPageContextSchema,
  type EvryPageContext,
} from "@/lib/evry/resolvers/contract";

const CONTEXT_PREFIX = "Evry page hint (untrusted record reference): ";
const requests = new WeakMap<Request, EvryPageContext | null>();

/** Same-process transport hint only. Authority still comes from the signed-in session. */
export function rememberEvePageHint(request: Request, context: unknown) {
  const value =
    context && typeof context === "object" && "pageContext" in context
      ? context.pageContext
      : null;
  const parsed = evryPageContextSchema.safeParse(value);
  requests.set(request, parsed.success ? parsed.data : null);
}

export function evePageHintMessage(request: Request): string {
  return CONTEXT_PREFIX + JSON.stringify(requests.get(request) ?? null);
}

export function pageHintFromMessages(
  messages: readonly ModelMessage[]
): EvryPageContext | null {
  for (const message of [...messages].reverse()) {
    if (
      message.role !== "user" ||
      typeof message.content !== "string" ||
      !message.content.startsWith(CONTEXT_PREFIX)
    )
      continue;
    try {
      return (
        evryPageContextSchema.safeParse(
          JSON.parse(message.content.slice(CONTEXT_PREFIX.length))
        ).data ?? null
      );
    } catch {
      return null;
    }
  }
  return null;
}
