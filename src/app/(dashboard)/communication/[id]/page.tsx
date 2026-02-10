import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  CheckCheck,
  Eye,
  AlertTriangle,
  Calendar,
  ExternalLink,
} from "lucide-react";

import { HeaderBreadcrumbs } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { verifySession } from "@/lib/auth/session";
import {
  getCommunication,
  getCommunicationRecipients,
} from "@/lib/communication/service";
import {
  renderTemplate,
  buildChurchMergeData,
  buildMeetingMergeData,
  buildPersonMergeData,
} from "@/lib/communication/merge";
import { db } from "@/db";
import { churches } from "@/db/schema/church";
import { churchMeetings } from "@/db/schema/meetings";
import { eq, and } from "drizzle-orm";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

interface MessageDetailPageProps {
  params: Promise<{ id: string }>;
}

const recipientStatusConfig: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  pending: { label: "Pending", color: "bg-gray-100 text-gray-600", icon: "" },
  sent: { label: "Sent", color: "bg-blue-100 text-blue-700", icon: "" },
  delivered: {
    label: "Delivered",
    color: "bg-green-100 text-green-700",
    icon: "",
  },
  opened: {
    label: "Opened",
    color: "bg-emerald-100 text-emerald-700",
    icon: "",
  },
  clicked: {
    label: "Clicked",
    color: "bg-teal-100 text-teal-700",
    icon: "",
  },
  bounced: { label: "Bounced", color: "bg-red-100 text-red-700", icon: "" },
  failed: { label: "Failed", color: "bg-red-100 text-red-700", icon: "" },
};

const meetingTypeLabels: Record<string, string> = {
  vision_meeting: "Vision Meeting",
  orientation: "Orientation",
  team_meeting: "Team Meeting",
};

export default async function MessageDetailPage({
  params,
}: MessageDetailPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const [comm, recipients] = await Promise.all([
    getCommunication(user.churchId, id),
    getCommunicationRecipients(id),
  ]);

  if (!comm) notFound();

  // Build merge data to resolve variables for display
  const [church] = await db
    .select()
    .from(churches)
    .where(eq(churches.id, user.churchId))
    .limit(1);

  let mergeData: Record<string, string> = {};
  if (church) {
    mergeData = { ...mergeData, ...buildChurchMergeData(church) };
  }

  // Load meeting if linked
  let meeting: typeof churchMeetings.$inferSelect | null = null;
  if (comm.meetingId) {
    const [m] = await db
      .select()
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.id, comm.meetingId),
          eq(churchMeetings.churchId, user.churchId)
        )
      )
      .limit(1);
    if (m) {
      meeting = m;
      mergeData = { ...mergeData, ...buildMeetingMergeData(m) };
    }
  }

  // Use first recipient's data for person fields in display
  const firstRecipient = recipients[0];
  if (firstRecipient) {
    mergeData = {
      ...mergeData,
      ...buildPersonMergeData(firstRecipient.person),
    };
  }

  // Placeholder for RSVP links in display
  mergeData.confirm_link = "#";
  mergeData.decline_link = "#";

  // Resolve variables
  const resolvedSubject = comm.subject
    ? renderTemplate(comm.subject, mergeData)
    : "(No subject)";
  const resolvedBody = renderTemplate(comm.body, mergeData);

  const deliveryRate =
    comm.stats.total > 0
      ? Math.round((comm.stats.delivered / comm.stats.total) * 100)
      : 0;
  const openRate =
    comm.stats.delivered > 0
      ? Math.round((comm.stats.opened / comm.stats.delivered) * 100)
      : 0;

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Communication", href: "/communication" },
          { label: resolvedSubject },
        ]}
      />
      <div className="flex h-full flex-col">
        <div className="bg-card p-6 shadow-sm">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="mb-4 cursor-pointer"
          >
            <Link href="/communication/history">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to Messages
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {resolvedSubject}
          </h1>
          <div className="mt-1 flex items-center gap-4">
            <p className="text-foreground/50">
              Sent{" "}
              {comm.sentAt
                ? format(comm.sentAt, "MMMM d, yyyy 'at' h:mm a")
                : "—"}
            </p>
            {meeting && (
              <Link
                href={`/meetings/${meeting.id}`}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
              >
                <Calendar className="h-3.5 w-3.5" />
                {meeting.title ||
                  meetingTypeLabels[meeting.type] ||
                  meeting.type}
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {/* Delivery Stats */}
          <div className="mb-6 grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Sent</CardTitle>
                <Mail className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{comm.stats.sent}</div>
                <p className="text-muted-foreground text-xs">
                  of {comm.stats.total} recipients
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Delivered
                </CardTitle>
                <CheckCheck className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {comm.stats.delivered}
                </div>
                <p className="text-muted-foreground text-xs">
                  {deliveryRate}% delivery rate
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Opened</CardTitle>
                <Eye className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{comm.stats.opened}</div>
                <p className="text-muted-foreground text-xs">
                  {openRate}% open rate
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Issues</CardTitle>
                <AlertTriangle className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {comm.stats.bounced + comm.stats.failed}
                </div>
                <p className="text-muted-foreground text-xs">
                  bounced or failed
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Recipients */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Recipients</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-sm font-medium text-gray-500">
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3">Timestamps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.map((r) => {
                      const config =
                        recipientStatusConfig[r.status] ??
                        recipientStatusConfig.pending;
                      return (
                        <tr
                          key={r.id}
                          className="border-b last:border-0 hover:bg-gray-50"
                        >
                          <td className="px-4 py-3 font-medium">
                            <Link
                              href={`/people/${r.personId}`}
                              className="cursor-pointer hover:underline"
                            >
                              {r.person.firstName} {r.person.lastName}
                            </Link>
                          </td>
                          <td className="text-muted-foreground px-4 py-3 text-sm">
                            {r.email}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              variant="secondary"
                              className={config.color}
                            >
                              {config.label}
                            </Badge>
                          </td>
                          <td className="text-muted-foreground px-4 py-3 text-xs">
                            {r.deliveredAt &&
                              `Delivered: ${format(r.deliveredAt, "MMM d, h:mm a")}`}
                            {r.openedAt &&
                              ` · Opened: ${format(r.openedAt, "MMM d, h:mm a")}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Message Content */}
          <Card>
            <CardHeader>
              <CardTitle>Message Content</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="whitespace-pre-wrap text-sm">{resolvedBody}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
