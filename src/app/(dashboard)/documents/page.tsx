import { redirect } from "next/navigation";

import { DocumentsLibrary } from "@/components/documents";
import { HeaderBreadcrumbs } from "@/components/header";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import { buildAutoFillDefaults, DOCUMENT_TEMPLATES } from "@/lib/documents";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const church = await getCurrentUserChurch();
  if (!church) {
    redirect("/dashboard");
  }

  const context = {
    churchName: church.name,
    userName: user.name ?? null,
    // `churches.launch_date` lands with the Phase Engine schema; wire it in when
    // that merges. No Phase-1 template uses the launch_date merge field yet.
    launchDate: null,
  };

  // Resolve auto-fill defaults server-side; the client library filters/renders.
  const items = DOCUMENT_TEMPLATES.map((template) => ({
    template,
    defaults: buildAutoFillDefaults(template, context),
  }));

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Documents" }]} />
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="bg-card space-y-1 p-6 pb-4 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-foreground/50">
            Generate print-ready documents with your church details filled in.
          </p>
        </div>

        {/* Library */}
        <div className="flex-1 overflow-auto p-6">
          <DocumentsLibrary items={items} />
        </div>
      </div>
    </>
  );
}
