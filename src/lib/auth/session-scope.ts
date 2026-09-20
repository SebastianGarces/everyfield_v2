import { AsyncLocalStorage } from "node:async_hooks";

const authenticatedSession = new AsyncLocalStorage<string>();

/** Trusted server transports only. The value must come from verified authentication metadata. */
export function withAuthenticatedSessionId<T>(
  sessionId: string,
  work: () => T
): T {
  return authenticatedSession.run(sessionId, work);
}

export function authenticatedSessionId(): string | undefined {
  return authenticatedSession.getStore();
}
