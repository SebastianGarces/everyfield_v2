import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { verifySession } from "@/lib/auth/session";
import { getTemplates, getTemplate } from "@/lib/communication/templates";
import { listMeetings } from "@/lib/meetings/service";
import { db } from "@/db";
import { persons } from "@/db/schema/people";
import { churches } from "@/db/schema/church";
import { HeaderBreadcrumbs } from "@/components/header";
import { ComposeForm } from "./compose-form";

export const dynamic = "force-dynamic";

interface ComposePageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ComposePage({ searchParams }: ComposePageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const params = await searchParams;
  const templateId = typeof params.templateId === "string" ? params.templateId : undefined;
  const meetingId = typeof params.meetingId === "string" ? params.meetingId : undefined;
  const recipientIdsParam = typeof params.recipientIds === "string" ? params.recipientIds : undefined;

  // Parse comma-separated recipient IDs from URL
  const recipientIds = recipientIdsParam
    ? recipientIdsParam.split(",").filter((id) => id.length > 0)
    : [];

  const [templates, selectedTemplate, meetingsResult, preloadedRecipients, churchRows] =
    await Promise.all([
      getTemplates(user.churchId),
      templateId ? getTemplate(templateId) : Promise.resolve(undefined),
      listMeetings(user.churchId, { status: "upcoming", limit: 50 }),
      recipientIds.length > 0
        ? db
            .select({
              id: persons.id,
              firstName: persons.firstName,
              lastName: persons.lastName,
              email: persons.email,
            })
            .from(persons)
            .where(inArray(persons.id, recipientIds))
        : Promise.resolve([]),
      db.select().from(churches).where(eq(churches.id, user.churchId)).limit(1),
    ]);

  // Serialize meetings for the client component
  const meetings = meetingsResult.meetings.map((m) => ({
    id: m.id,
    title: m.title,
    type: m.type,
    datetime: m.datetime.toISOString(),
    locationName: m.locationName,
    locationAddress: m.locationAddress,
  }));

  const churchName = churchRows[0]?.name ?? "";

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Communication", href: "/communication" },
          { label: "New Message" },
        ]}
      />
      <ComposeForm
        templates={templates}
        initialTemplate={selectedTemplate}
        meetingId={meetingId}
        meetings={meetings}
        initialRecipients={preloadedRecipients}
        churchName={churchName}
      />
    </>
  );
}
