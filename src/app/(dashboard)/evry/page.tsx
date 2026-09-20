import { redirect } from "next/navigation";

import { EvryWorkspace } from "@/components/evry/evry-workspace";
import { verifySession } from "@/lib/auth/session";
import { evryConversationHistorySearchSchema } from "@/lib/evry/conversations/history";
import { listEveSessions } from "@/lib/evry/eve/runtime/session-store";
import { formatDateTime, formatRelativeTimestamp } from "@/lib/datetime";
import { readEvryPlantTimeZone } from "@/lib/evry/reads/plant-time-zone";
import { evryConversationIdSchema } from "@/lib/evry/conversations/contract";
import {
  evryPlantStandingOf,
  requireEvryPlantViewer,
} from "@/lib/evry/eligibility/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Evry conversations" };

export default async function EvryPage({
  searchParams,
}: {
  searchParams: Promise<{
    artifactFixture?: string | string[];
    conversation?: string | string[];
    new?: string | string[];
    q?: string | string[];
  }>;
}) {
  const { user } = await verifySession();
  if (!user.churchId) {
    redirect("/dashboard");
  }
  if (evryPlantStandingOf(user).status !== "eligible") {
    redirect("/dashboard");
  }

  const actor = await requireEvryPlantViewer();
  const params = await searchParams;
  const search = evryConversationHistorySearchSchema.safeParse(
    typeof params.q === "string" ? params.q : ""
  );
  if (!search.success) redirect("/evry");
  const conversation = evryConversationIdSchema.safeParse(
    typeof params.conversation === "string" ? params.conversation : null
  );
  const newConversation =
    params.new === undefined
      ? false
      : typeof params.new === "string" && params.new === "1";
  if (params.new !== undefined && !newConversation) redirect("/evry");
  const now = new Date();
  const [sessions, timeZone] = await Promise.all([
    listEveSessions(actor, search.data),
    readEvryPlantTimeZone(actor.plantId),
  ]);
  const conversations = sessions.map((session) => ({
    id: session.conversationId,
    title: session.title,
    lastActivityAt: session.updatedAt.toISOString(),
    lastActivityLabel: formatRelativeTimestamp(
      session.updatedAt,
      now,
      timeZone
    ),
    lastActivityTitle: formatDateTime(session.updatedAt, "short", timeZone),
    actionableState: "ready" as const,
  }));

  return (
    <EvryWorkspace
      conversations={conversations}
      conversationId={
        !newConversation && conversation.success ? conversation.data : null
      }
      newConversation={newConversation}
      searchQuery={search.data}
      showArtifactFixture={
        process.env.VERCEL_ENV === "preview" &&
        typeof params.artifactFixture === "string" &&
        params.artifactFixture === "typed-artifacts"
      }
      showStreamingFixture={
        process.env.VERCEL_ENV === "preview" &&
        typeof params.artifactFixture === "string" &&
        params.artifactFixture === "streaming-states"
      }
    />
  );
}
