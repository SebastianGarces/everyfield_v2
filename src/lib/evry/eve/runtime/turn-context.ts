import type { ModelMessage } from "ai";
import { evryTurnInput } from "./task-state";
import { titleEveSessionIfNew } from "./session-store";
import type { EveAuthenticatedSession } from "./auth-policy";
import { pageHintFromMessages } from "./client-context";
import { bindIsolatedFixtureTurn, fixtureRun } from "./fixture-bridge";

/** Tool resolvers include the incoming delivery; instruction resolvers intentionally do not. */
export async function captureEveTurnInput(input: {
  sessionId: string;
  identity: EveAuthenticatedSession;
  messages: readonly ModelMessage[];
}) {
  bindIsolatedFixtureTurn(input.identity);
  const fixture = fixtureRun(input.identity);
  const lastUser = [...input.messages]
    .reverse()
    .find((message) => message.role === "user");
  const text =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
        : "";
  evryTurnInput.update(() => ({
    text,
    receivedAt: (fixture?.now ?? new Date()).toISOString(),
    pageContext: pageHintFromMessages(input.messages),
  }));
  fixture?.turnInput(evryTurnInput.get().text);
  await titleEveSessionIfNew(input.sessionId, input.identity, text);
}
