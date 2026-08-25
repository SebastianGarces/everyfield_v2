import { History } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DocumentsLibrary } from "@/components/documents";
import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { Button } from "@/components/ui/button";
import { verifySession } from "@/lib/auth/session";
import { buildAutoFillDefaults, DOCUMENT_TEMPLATES } from "@/lib/documents";
import { resolveDocumentMergeContext } from "@/lib/documents/merge-context";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  await verifySession();

  // One resolver for the church + launch-day context, shared with the
  // generation route (`merge-context.ts`), so the auto-fill preview and the
  // generated file name the same day. Null covers "no church" in every form.
  const context = await resolveDocumentMergeContext();
  if (!context) {
    redirect("/dashboard");
  }

  // Resolve auto-fill defaults server-side; the client library filters/renders.
  const items = DOCUMENT_TEMPLATES.map((template) => ({
    template,
    defaults: buildAutoFillDefaults(template, context.merge),
  }));
  const breadcrumbs = [{ label: "Documents" }];

  // A contextual link (DOC-014) arrives with `?template=<id>` and opens that
  // template's generate dialog. The library reads that parameter itself with
  // `useSearchParams`, so this page does not thread it through as a prop and
  // does not remount the library to apply it — remounting discarded the user's
  // search/category/phase/format filters on every contextual arrival. Unknown
  // ids still open nothing, which the library enforces against its own catalog.
  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        className="overflow-hidden"
        contextAttachment="attached"
        contextItems={breadcrumbs}
      >
        <WorkspacePanel className="flex h-full flex-col overflow-hidden">
          {/* Header */}
          <div className="space-y-1 border-b p-4 sm:p-6 sm:pb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Documents
                </h1>
                <p className="text-muted-foreground">
                  Generate print-ready documents with your church details filled
                  in.
                </p>
              </div>
              <Button
                asChild
                variant="outline"
                className="cursor-pointer sm:shrink-0"
              >
                <Link href="/documents/history">
                  <History className="mr-2 h-4 w-4" />
                  History
                </Link>
              </Button>
            </div>
          </div>

          {/* Library */}
          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            {/* `useSearchParams` inside the library needs a boundary above it. */}
            <Suspense fallback={null}>
              <DocumentsLibrary items={items} />
            </Suspense>
          </div>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
