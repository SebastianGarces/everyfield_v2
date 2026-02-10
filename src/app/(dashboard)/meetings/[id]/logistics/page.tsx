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
  if (!user.churchId) redirect("/login");

  const { id } = await params;
  const [meeting, checklist, checklistSummary] = await Promise.all([
    getMeeting(user.churchId, id),
    getChecklist(user.churchId, id),
    getChecklistSummary(user.churchId, id),
  ]);

  if (!meeting) notFound();

  return (
    <MaterialsChecklist
      meetingId={meeting.id}
      items={checklist}
      summary={checklistSummary}
    />
  );
}
