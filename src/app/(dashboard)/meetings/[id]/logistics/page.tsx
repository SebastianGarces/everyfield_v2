import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import {
  getChecklist,
  getChecklistSummary,
  getMeeting,
} from "@/lib/meetings/service";
import { MaterialsChecklist } from "@/components/meetings/materials-checklist";

export const dynamic = "force-dynamic";

interface LogisticsPageProps {
  params: Promise<{ id: string }>;
}

export default async function LogisticsPage({ params }: LogisticsPageProps) {
  const { user } = await verifySession();
  // Signed in already — `verifySession` throws otherwise — just without a plant.
  // /login was the wrong answer to that: it is not what is missing, and a live
  // session is bounced straight back off the login page (#503). /dashboard is
  // where an account with no plant belongs, and it says so.
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [meeting, checklist, checklistSummary] = await Promise.all([
    getMeeting(user.churchId, id),
    getChecklist(user.churchId, id),
    getChecklistSummary(user.churchId, id),
  ]);

  if (!meeting) notFound();
  return <MaterialsChecklist items={checklist} summary={checklistSummary} />;
}
