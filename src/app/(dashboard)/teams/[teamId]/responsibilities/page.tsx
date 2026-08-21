import { redirect } from "next/navigation";

import { ResponsibilitiesTab } from "@/components/ministry-teams/responsibilities-tab";
import { verifySession } from "@/lib/auth/session";
import { listResponsibilities } from "@/lib/ministry-teams/service";

export const dynamic = "force-dynamic";

/**
 * `listResponsibilities` SEEDS a predefined team's playbook items on its first
 * read, so this render can write — which is legal precisely because the render
 * is never cached (`force-dynamic` above) and nothing on that path revalidates.
 * The claim that makes it once-ever is on the team row; see
 * `ministry-teams/responsibilities.ts`.
 *
 * THE 404 IS THE LAYOUT'S. `[teamId]/layout.tsx` already reads the team
 * church-scoped and calls `notFound()`, so this page only ever renders for a
 * team the caller owns — and it no longer needs the team at all, which is one
 * fewer read of a row it was only using for its `template_key`. The seed's own
 * `WHERE` is church-scoped besides, so a foreign id would claim nothing.
 */
export default async function TeamResponsibilitiesPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { user } = await verifySession();
  const { teamId } = await params;

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const responsibilities = await listResponsibilities(
    user.churchId,
    teamId,
    user.id
  );

  return (
    <ResponsibilitiesTab teamId={teamId} responsibilities={responsibilities} />
  );
}
