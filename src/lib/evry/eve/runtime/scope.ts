import type { ToolContext } from "eve/tools";
import { withAuthenticatedSessionId } from "@/lib/auth/session-scope";
import {
  requireEvryPlantViewerForSession,
  type EvryPlantActor,
} from "@/lib/evry/eligibility/viewer";
import { authenticatedSessionOf } from "./auth-policy";
import { getEveSession } from "./session-store";

export type EveRuntimeScope = Readonly<{
  actor: EvryPlantActor;
  appSessionId: string;
  eveSessionId: string;
  conversationId: string;
  turnId: string;
}>;

export async function withEveRuntimeScope<T>(
  ctx: Pick<ToolContext, "session">,
  work: (scope: EveRuntimeScope) => Promise<T>
): Promise<T> {
  const identity = authenticatedSessionOf(ctx.session.auth.current);
  const actor = await requireEvryPlantViewerForSession(identity.appSessionId);
  if (actor.userId !== identity.userId || actor.plantId !== identity.plantId)
    throw new Error("Conversation unavailable");
  const session = await getEveSession(ctx.session.id, identity);
  if (!session) throw new Error("Conversation unavailable");
  return withAuthenticatedSessionId(identity.appSessionId, () =>
    work({
      actor,
      appSessionId: identity.appSessionId,
      eveSessionId: ctx.session.id,
      conversationId: session.conversationId,
      turnId: ctx.session.turn.id,
    })
  );
}
