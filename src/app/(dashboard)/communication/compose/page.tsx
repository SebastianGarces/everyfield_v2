import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { getTemplates, getTemplate } from "@/lib/communication/templates";
import { meetingInvitationTemplate } from "@/lib/communication/system-templates";
import { listRecipientTeams } from "@/lib/communication/recipient-groups";
import { listMeetings } from "@/lib/meetings/service";
import { db } from "@/db";
import { persons } from "@/db/schema/people";
import { churches } from "@/db/schema/church";
import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { ComposeForm } from "./compose-form";

export const dynamic = "force-dynamic";

interface ComposePageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ComposePage({ searchParams }: ComposePageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  // THE ROUTE EXISTS ONLY TO WRITE (AS-020, recipe rule 3). Hiding "New
  // Message" while /communication/compose stayed reachable by URL is a screen a
  // Member walks into, picks recipients on, writes a message in, and is refused
  // at send — so the door shuts on the same verb `sendCommunicationAction`
  // refuses with. It also stops the six deep links from elsewhere in the app
  // (the guest list's Send Email, a person's Email button) landing anybody here
  // who cannot finish.
  if (!holdsSeatFor(user, "communication.send")) {
    redirect("/communication");
  }

  const params = await searchParams;
  const templateId =
    typeof params.templateId === "string" ? params.templateId : undefined;
  const meetingId =
    typeof params.meetingId === "string" ? params.meetingId : undefined;
  const recipientIdsParam =
    typeof params.recipientIds === "string" ? params.recipientIds : undefined;

  // Parse comma-separated recipient IDs from URL
  const recipientIds = recipientIdsParam
    ? recipientIdsParam.split(",").filter((id) => id.length > 0)
    : [];

  const [
    templates,
    selectedTemplate,
    meetingsResult,
    preloadedRecipients,
    churchRows,
    teams,
  ] = await Promise.all([
    getTemplates(user.churchId),
    templateId
      ? getTemplate(templateId, user.churchId)
      : Promise.resolve(undefined),
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
          // Tenant isolation is application-layer — this predicate IS the
          // boundary. A foreign or soft-deleted id preloads nobody.
          .where(
            and(
              inArray(persons.id, recipientIds),
              eq(persons.churchId, user.churchId),
              isNull(persons.deletedAt)
            )
          )
      : Promise.resolve([]),
    db.select().from(churches).where(eq(churches.id, user.churchId)).limit(1),
    listRecipientTeams(user.churchId),
  ]);

  // Serialize meetings for the client component
  const meetings = meetingsResult.meetings.map((m) => ({
    id: m.id,
    title: m.title,
    type: m.type,
    datetime: m.datetime.toISOString(),
    locationName: m.locationName,
    locationAddress: m.locationAddress,
    // Plain JSON out of the `jsonb` column — it crosses to the client as it is
    // and `buildMeetingMergeData` parses it there, the same call the send path
    // makes on the server.
    agenda: m.agenda,
  }));

  const churchName = churchRows[0]?.name ?? "";

  // Arriving from a meeting with no template named? Open with the invitation
  // that meeting type calls for. RESOLVED HERE, on the server, and handed on as
  // `initialTemplate` — the relation lives on the system catalog
  // (`invitesMeetingType`), and a client component that read that catalog would
  // ship every template body to the browser. The form takes a template or none
  // and no longer decides anything about meeting types (#612).
  const composingForMeeting = meetings.find((m) => m.id === meetingId);
  const autoTemplate =
    selectedTemplate || !composingForMeeting
      ? undefined
      : (meetingInvitationTemplate(composingForMeeting.type, templates) ??
        undefined);

  const breadcrumbs = [
    { label: "Communication", href: "/communication" },
    { label: "New Message" },
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
        <h1 className="sr-only">New message</h1>
        <WorkspacePanel className="h-full overflow-hidden">
          <ComposeForm
            templates={templates}
            initialTemplate={selectedTemplate ?? autoTemplate}
            meetingId={meetingId}
            meetings={meetings}
            initialRecipients={preloadedRecipients}
            churchName={churchName}
            teams={teams}
          />
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
