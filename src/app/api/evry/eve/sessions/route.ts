import { z } from "zod";
import { requireFreshEvryPlantViewer } from "@/lib/evry/eligibility/viewer";
import { eveHttpRefusal, privateEveJson } from "@/lib/evry/eve/runtime/http";
import {
  getEveSession,
  getEveSessionForConversation,
  listEveSessions,
} from "@/lib/evry/eve/runtime/session-store";

export const dynamic = "force-dynamic";

const querySchema = z
  .strictObject({
    conversationId: z.string().uuid().optional(),
    sessionId: z.string().min(1).max(200).optional(),
  })
  .refine((value) => !(value.conversationId && value.sessionId));

export async function GET(request: Request) {
  try {
    const actor = await requireFreshEvryPlantViewer();
    const query = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    if (!query.success) return privateEveJson({ status: "invalid" }, 400);
    const { conversationId, sessionId } = query.data;
    if (!conversationId && !sessionId)
      return privateEveJson({ sessions: await listEveSessions(actor) });
    const session = conversationId
      ? await getEveSessionForConversation(conversationId, actor)
      : await getEveSession(sessionId!, actor);
    if (!session) return privateEveJson({ status: "unavailable" }, 404);
    return privateEveJson({
      session: {
        id: session.id,
        conversationId: session.conversationId,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    });
  } catch (error) {
    const refusal = eveHttpRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}
