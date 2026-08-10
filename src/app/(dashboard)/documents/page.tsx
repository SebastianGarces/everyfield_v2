import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DocumentsLibrary } from "@/components/documents";
import { HeaderBreadcrumbs } from "@/components/header";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import { buildAutoFillDefaults, DOCUMENT_TEMPLATES } from "@/lib/documents";
import { getLaunchForChurch } from "@/lib/launch/queries";

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

  // A contextual link (DOC-014) arrives with `?template=<id>` and opens that
  // template's generate dialog. The library reads that parameter itself with
  // `useSearchParams`, so this page does not thread it through as a prop and
  // does not remount the library to apply it — remounting discarded the user's
  // search/category/phase/format filters on every contextual arrival. Unknown
  // ids still open nothing, which the library enforces against its own catalog.
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
          {/* `useSearchParams` inside the library needs a boundary above it. */}
          <Suspense fallback={null}>
            <DocumentsLibrary items={items} />
          </Suspense>
        </div>
      </div>
    </>
  );
}
