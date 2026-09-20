import { ForbiddenError } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import type { EveSessionOwner, EveSessionStore } from "./session-store";

export type EveAuthenticatedSession = EveSessionOwner &
  Readonly<{ appSessionId: string }>;

export function readSessionCookie(request: Request): string | null {
  const values = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("session="));
  if (values.length !== 1) return null;
  try {
    return decodeURIComponent(values[0]!.slice(8)) || null;
  } catch {
    return null;
  }
}

export function requireSameOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new ForbiddenError({ message: "Request unavailable." });
  }
}

export function principalForSession(
  session: EveAuthenticatedSession
): SessionAuthContext {
  return {
    authenticator: "everyfield-session",
    principalId: session.userId,
    principalType: "user",
    attributes: {
      plantId: session.plantId,
      appSessionId: session.appSessionId,
    },
  };
}

/** Identity lives in framework-authenticated metadata, never a model tool input. */
export function authenticatedSessionOf(
  principal: SessionAuthContext | null
): EveAuthenticatedSession {
  if (
    principal?.authenticator !== "everyfield-session" ||
    principal.principalType !== "user" ||
    typeof principal.principalId !== "string" ||
    typeof principal.attributes?.plantId !== "string" ||
    typeof principal.attributes?.appSessionId !== "string" ||
    !/^[a-f0-9]{64}$/.test(principal.attributes.appSessionId)
  ) {
    throw new ForbiddenError({ message: "Conversation unavailable." });
  }
  return {
    userId: principal.principalId,
    plantId: principal.attributes.plantId,
    appSessionId: principal.attributes.appSessionId,
  };
}

export function createEveAuthPolicy(deps: {
  authenticate(token: string): Promise<EveAuthenticatedSession | null>;
  store: Pick<EveSessionStore, "owns">;
}): (request: Request) => Promise<SessionAuthContext | null> {
  return async (request) => {
    const token = readSessionCookie(request);
    if (!token) return null;
    const session = await deps.authenticate(token);
    if (!session) return null;
    requireSameOrigin(request);
    const path = new URL(request.url).pathname;
    const match = /\/eve\/v1\/session\/([^/]+)/.exec(path);
    if (
      match &&
      !(await deps.store.owns(decodeURIComponent(match[1]!), session))
    ) {
      throw new ForbiddenError({ message: "Conversation unavailable." });
    }
    return principalForSession(session);
  };
}
