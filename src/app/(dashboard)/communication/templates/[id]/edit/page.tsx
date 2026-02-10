import { redirect, notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { getTemplate } from "@/lib/communication/templates";
import { HeaderBreadcrumbs } from "@/components/header";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

interface EditTemplatePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditTemplatePage({ params }: EditTemplatePageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const template = await getTemplate(id);
  if (!template) notFound();

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Communication", href: "/communication" },
          { label: "Templates", href: "/communication/templates" },
          { label: template.name },
        ]}
      />
      <TemplateEditor template={template} />
    </>
  );
}
