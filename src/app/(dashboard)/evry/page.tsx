import { redirect } from "next/navigation";

import { EvryWorkspace } from "@/components/evry/evry-workspace";
import { verifySession } from "@/lib/auth/session";
import { evryPlantStandingOf } from "@/lib/evry/eligibility/viewer";

export const dynamic = "force-dynamic";

export default async function EvryPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string }>;
}) {
  const { user } = await verifySession();
  if (!user.churchId) {
    redirect("/dashboard");
  }
  if (evryPlantStandingOf(user).status !== "eligible") {
    redirect("/dashboard");
  }

  const { conversation } = await searchParams;
  return <EvryWorkspace conversationId={conversation ?? null} />;
}
