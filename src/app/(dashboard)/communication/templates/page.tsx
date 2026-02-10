import { redirect } from "next/navigation";
import Link from "next/link";
import { Mail, Pencil, Eye } from "lucide-react";

import { HeaderBreadcrumbs } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { verifySession } from "@/lib/auth/session";
import { getTemplates } from "@/lib/communication/templates";
import type { TemplateCategory } from "@/db/schema/communication";

export const dynamic = "force-dynamic";

const categoryLabels: Record<TemplateCategory, string> = {
  meeting_invitation: "Meeting Invitation",
  meeting_reminder: "Meeting Reminder",
  follow_up: "Follow-Up",
  core_group: "Core Group",
  team: "Team",
  announcement: "Announcement",
  launch: "Launch",
  other: "Other",
};

export default async function TemplatesPage() {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const templates = await getTemplates(user.churchId);

  // Group by category
  const grouped = templates.reduce(
    (acc, t) => {
      const cat = t.category as TemplateCategory;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(t);
      return acc;
    },
    {} as Record<string, typeof templates>
  );

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Communication", href: "/communication" },
          { label: "Templates" },
        ]}
      />
      <div className="flex h-full flex-col">
        <div className="bg-card space-y-6 p-6 pb-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Message Templates
              </h1>
              <p className="text-foreground/50">
                Pre-built templates for common communications
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {Object.entries(grouped).map(([category, categoryTemplates]) => (
            <div key={category} className="mb-8">
              <h2 className="mb-3 text-lg font-semibold">
                {categoryLabels[category as TemplateCategory] ?? category}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {categoryTemplates.map((template) => (
                  <Card key={template.id}>
                    <CardContent className="p-4">
                      <div className="mb-2 flex items-start justify-between">
                        <div>
                          <p className="font-medium">{template.name}</p>
                          {template.sourceTemplateId && (
                            <Badge
                              variant="outline"
                              className="mt-1 text-xs"
                            >
                              Customized
                            </Badge>
                          )}
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {template.channel}
                        </Badge>
                      </div>
                      {template.description && (
                        <p className="text-muted-foreground mb-3 text-sm">
                          {template.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <Button variant="default" size="sm" asChild>
                          <Link
                            href={`/communication/compose?templateId=${template.id}`}
                            className="cursor-pointer"
                          >
                            <Mail className="mr-1 h-3 w-3" />
                            Use
                          </Link>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            href={`/communication/templates/${template.id}/edit`}
                            className="cursor-pointer"
                          >
                            <Pencil className="mr-1 h-3 w-3" />
                            Edit
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}

          {templates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12">
              <Mail className="text-muted-foreground mb-4 h-12 w-12" />
              <p className="text-muted-foreground text-lg font-medium">
                No templates available
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
