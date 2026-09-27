import { redirect } from "next/navigation";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { TemplateEditor } from "../[id]/edit/template-editor";

export default async function NewTemplatePage() {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");
  if (!holdsSeatFor(user, "communication.send"))
    redirect("/communication/templates");
  const breadcrumbs = [
    { label: "Communication", href: "/communication" },
    { label: "Templates", href: "/communication/templates" },
    { label: "Create Template" },
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
        <h1 className="sr-only">Create Template</h1>
        <WorkspacePanel className="h-full overflow-hidden">
          <TemplateEditor />
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
