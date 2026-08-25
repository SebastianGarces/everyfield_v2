import { redirect, notFound } from "next/navigation";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { getTemplate } from "@/lib/communication/templates";
import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

interface EditTemplatePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditTemplatePage({
  params,
}: EditTemplatePageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  // A WRITE-ONLY ROUTE (AS-020, recipe rule 3). The editor is a form over the
  // template body and nothing else — and opening it on a SYSTEM template forks
  // a church-owned copy on first save, so simply arriving here is a write in
  // waiting. A viewer who cannot send cannot edit what gets sent; the catalog
  // at /communication/templates is where they read the same bodies.
  if (!holdsSeatFor(user, "communication.send")) {
    redirect("/communication/templates");
  }

  const { id } = await params;
  const template = await getTemplate(id, user.churchId);
  if (!template) notFound();
  const breadcrumbs = [
    { label: "Communication", href: "/communication" },
    { label: "Templates", href: "/communication/templates" },
    { label: template.name },
  ];

  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        className="overflow-hidden"
        contextAttachment="attached"
        contextItems={breadcrumbs}
        scrollLayout="fixed"
      >
        <h1 className="sr-only">Edit {template.name}</h1>
        <WorkspacePanel className="h-full overflow-hidden">
          <TemplateEditor template={template} />
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
