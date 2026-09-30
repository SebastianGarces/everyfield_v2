import { notFound, redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { TeamDetailHeader } from "@/components/ministry-teams/team-detail-header";
import { TeamWriteProvider } from "@/components/ministry-teams/team-write-context";
import { mayManageTeam } from "@/lib/ministry-teams/authorization";
import { TeamTabs } from "@/components/ministry-teams/team-tabs";
import { verifySession } from "@/lib/auth/session";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { listRecordCorrections } from "@/lib/corrections/history";
import { getTeam } from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

export default async function TeamDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ teamId: string }>;
}) {
  const { user } = await verifySession();
  const { teamId } = await params;

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const team = await getTeam(user.churchId, teamId);

  if (!team) {
    notFound();
  }

  const canManage = await mayManageTeam(user, teamId);
  const corrections = holdsSeatFor(user, "teams.write")
    ? await listRecordCorrections(user.churchId, "team", teamId)
    : [];

  const breadcrumbs = [
    { label: "Ministry Teams", href: "/teams" },
    { label: team.name },
  ];

  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        contextAttachment="attached"
        contextItems={breadcrumbs}
        scrollLayout="flow"
      >
        <WorkspacePanel className="min-h-full">
          <TeamDetailHeader team={team} />
          {corrections.length > 0 && (
            <details className="mx-6 my-3 rounded border p-3">
              <summary className="cursor-pointer">
                Team correction history ({corrections.length})
              </summary>
              {corrections.map((c) => (
                <div key={c.id} className="mt-3 border-t pt-3 text-sm">
                  <p>
                    {c.correctedAt.toLocaleString("en-US", { timeZone: "UTC" })}{" "}
                    UTC
                  </p>
                  {["name", "description", "status"].map((field) => (
                    <p key={field}>
                      <span className="capitalize">{field}</span>:{" "}
                      {String(
                        (c.before as Record<string, unknown>)[field] ?? "—"
                      )}{" "}
                      →{" "}
                      {String(
                        (c.after as Record<string, unknown>)[field] ?? "—"
                      )}
                    </p>
                  ))}
                </div>
              ))}
            </details>
          )}
          <div className="px-4 pt-0 sm:px-6">
            <TeamTabs teamId={teamId} />
          </div>
          <TeamWriteProvider writableTeamId={canManage ? teamId : null}>
            <div className="p-4 sm:p-6">{children}</div>
          </TeamWriteProvider>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
