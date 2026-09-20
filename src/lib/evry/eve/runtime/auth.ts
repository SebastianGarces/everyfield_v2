import { validateSessionToken } from "@/lib/auth/session-token";
import { evryPlantStandingOf } from "@/lib/evry/eligibility/viewer";
import {
  createEveAuthPolicy,
  type EveAuthenticatedSession,
} from "./auth-policy";
import { eveSessionStore } from "./session-store";

export async function authenticateEveCookie(
  token: string
): Promise<EveAuthenticatedSession | null> {
  const { session, user } = await validateSessionToken(token);
  if (!session || !user) return null;
  const standing = evryPlantStandingOf(user);
  if (standing.status !== "eligible") return null;
  return {
    appSessionId: session.id,
    userId: standing.userId,
    plantId: standing.plantId,
  };
}

export const eveAppAuth = createEveAuthPolicy({
  authenticate: authenticateEveCookie,
  store: eveSessionStore,
});
