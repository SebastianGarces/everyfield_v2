import { redirect } from "next/navigation";
import { HeaderBreadcrumbs } from "@/components/header";
import { AssistantShell } from "@/components/assistant/assistant-shell";
import { verifySession } from "@/lib/auth/session";
import {
  getAssistantThread,
  listAssistantHistory,
  restoreAssistantThread,
} from "@/lib/assistant/service";

interface AssistantThreadPageProps {
  params: Promise<{ threadId: string }>;
}

export default async function AssistantThreadPage({
  params,
}: AssistantThreadPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const { threadId } = await params;
  const existingDetail = await getAssistantThread(
    user.churchId,
    user.id,
    threadId
  );

  if (!existingDetail) {
    redirect("/assistant");
  }

  await restoreAssistantThread(user.churchId, user.id, threadId);

  const [history, detail] = await Promise.all([
    listAssistantHistory(user.churchId, user.id),
    getAssistantThread(user.churchId, user.id, threadId),
  ]);

  if (!detail) {
    redirect("/assistant");
  }

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "AI Assistant" }]} />
      <div className="mx-auto w-full max-w-6xl p-6">
        <AssistantShell
          key={detail.thread.id}
          initialHistory={history}
          initialDetail={detail}
        />
      </div>
    </>
  );
}
