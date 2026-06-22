import { redirect } from "next/navigation";

import { TemplateCard } from "@/components/documents";
import { HeaderBreadcrumbs } from "@/components/header";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import {
  buildAutoFillDefaults,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DOCUMENT_TEMPLATES,
} from "@/lib/documents";

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

  const categories = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    templates: DOCUMENT_TEMPLATES.filter((t) => t.category === category),
  })).filter((group) => group.templates.length > 0);

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
        <div className="flex-1 space-y-10 overflow-auto p-6">
          {categories.map((group) => (
            <section key={group.category} className="space-y-4">
              <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
                {group.label}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    defaults={buildAutoFillDefaults(template, context)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
