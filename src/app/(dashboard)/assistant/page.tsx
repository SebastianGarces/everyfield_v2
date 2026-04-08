import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { getOrCreateLatestAssistantThread } from "@/lib/assistant/service";

export default async function AssistantPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const thread = await getOrCreateLatestAssistantThread(user.churchId, user.id);
  redirect(`/assistant/${thread.id}`);
}
