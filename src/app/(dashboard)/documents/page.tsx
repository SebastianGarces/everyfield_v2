import { redirect } from "next/navigation";

import { DocumentsLibrary } from "@/components/documents";
import { HeaderBreadcrumbs } from "@/components/header";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import {
  buildAutoFillDefaults,
  DOCUMENT_TEMPLATES,
  getTemplateById,
} from "@/lib/documents";
import { getLaunchForChurch } from "@/lib/launch/queries";

export const dynamic = "force-dynamic";

interface DocumentsPageProps {
  /** `?template=<id>` — set by contextual links from other features (DOC-014). */
  searchParams: Promise<{ template?: string }>;
}

export default async function DocumentsPage({
  searchParams,
}: DocumentsPageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const church = await getCurrentUserChurch();
  if (!church) {
    redirect("/dashboard");
  }

  // The launch date is read from the LAUNCH ENTITY (`launches.target_date`,
  // LS-001) and never from the church row, whose `launch_date` column migration
  // 0032 dropped. `null` here now means what it says — this plant has no launch
  // row, or one still `planning` with no day named — rather than "nobody has
  // wired this up yet" (#306).
  const launch = await getLaunchForChurch(church.id);

  const context = {
    churchName: church.name,
    userName: user.name ?? null,
    launchDate: launch?.targetDate ?? null,
  };

  // Resolve auto-fill defaults server-side; the client library filters/renders.
  const items = DOCUMENT_TEMPLATES.map((template) => ({
    template,
    defaults: buildAutoFillDefaults(template, context),
  }));

  // A contextual link (DOC-014) arrives with ?template=<id> and opens that
  // template's generate dialog. Unknown ids are ignored — never a dead link.
  const { template: requestedTemplate } = await searchParams;
  const initialTemplateId =
    requestedTemplate && getTemplateById(requestedTemplate)
      ? requestedTemplate
      : undefined;

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Documents" }]} />
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="bg-card space-y-1 p-6 pb-4 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">
            Generate print-ready documents with your church details filled in.
          </p>
        </div>

        {/* Library */}
        <div className="flex-1 overflow-auto p-6">
          <DocumentsLibrary
            key={initialTemplateId ?? "all"}
            items={items}
            initialTemplateId={initialTemplateId}
          />
        </div>
      </div>
    </>
  );
}
