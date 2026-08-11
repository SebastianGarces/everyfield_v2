import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DocumentsLibrary } from "@/components/documents";
import { HeaderBreadcrumbs } from "@/components/header";
import { verifySession } from "@/lib/auth/session";
import { buildAutoFillDefaults, DOCUMENT_TEMPLATES } from "@/lib/documents";
import { resolveDocumentMergeContext } from "@/lib/documents/merge-context";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  await verifySession();

  // One resolver for the church + launch-day context, shared with the
  // generation route (`merge-context.ts`), so the auto-fill preview and the
  // generated file name the same day. Null covers "no church" in every form.
  const resolved = await resolveDocumentMergeContext();
  if (!resolved) {
    redirect("/dashboard");
  }

  // Resolve auto-fill defaults server-side; the client library filters/renders.
  const items = DOCUMENT_TEMPLATES.map((template) => ({
    template,
    defaults: buildAutoFillDefaults(template, resolved.context),
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
