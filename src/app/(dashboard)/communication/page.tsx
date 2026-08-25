import { Mail, Plus, Send } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas } from "@/components/layout/page-frame";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeliveryOverview } from "@/components/communication/delivery-overview";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import {
  countCommunications,
  countSentSince,
  getChurchDeliveryTotals,
  getCommunications,
  resolveSubjects,
} from "@/lib/communication/service";
import {
  communicationEmptyStateLine,
  communicationHubSubtitle,
} from "@/lib/communication/presentation";
import {
  communicationStatusBadgeClass,
  communicationStatusLabel,
} from "@/lib/communication/status-display";
import { getTemplates } from "@/lib/communication/templates";
// Dates render through the pinned-zone formatter, never date-fns —
// memory/invariants.md → Date & Time Rendering (ruled 2026-08-12, 407-3-1).
import {
  DEFAULT_CHURCH_TIME_ZONE,
  formatRelativeTimestamp,
} from "@/lib/datetime";

export const dynamic = "force-dynamic";

export default async function CommunicationPage() {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  // Every route out of this hub that is not a read ends at the compose form,
  // and composing is `communication.send` (AS-020, #499). A server component
  // with the session in hand asks the table directly — same table `requireSeat`
  // refuses the send with, one hop fewer than the client transport.
  const canSend = holdsSeatFor(user, "communication.send");

  // One `now` per render: every row's relative label is measured against the
  // same instant, so a list can never show times that disagree with each other.
  const now = new Date();

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // "Sent This Week" and the logged count are COUNTED, not derived from the 10
  // rows below them: a sample of the most recent messages cannot answer either
  // question, and a logged contact must never land in a number labelled "Sent"
  // (COM-020 ruling — the split is shown, not hidden).
  const [
    church,
    { communications: recentMessages, total },
    templates,
    deliveryTotals,
    sentThisWeek,
    loggedCount,
  ] = await Promise.all([
    getCurrentUserChurch(),
    getCommunications(user.churchId, { limit: 10 }),
    getTemplates(user.churchId),
    getChurchDeliveryTotals(user.churchId),
    countSentSince(user.churchId, weekAgo),
    countCommunications(user.churchId, { status: "logged" }),
  ]);

  // Resolve merge field variables in subjects for display
  const resolvedSubjectMap = await resolveSubjects(
    user.churchId,
    recentMessages
  );

  const timeZone = church?.timeZone ?? DEFAULT_CHURCH_TIME_ZONE;

  // Quick action templates (show first 4 system/popular templates)
  const quickActions = templates.filter((t) => t.isSystem).slice(0, 4);

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Communication" }]} />
      <PageCanvas className="overflow-hidden" context="none" contentFocusTarget>
        {/* This overview is a collection of peer surfaces, not one workspace.
            Removing the old outer panel is the only markup change: its
            border/padding nested every metric and message card inside a false
            second boundary that CSS could not remove without also changing
            real Card boundaries. Data, actions, and scroll ownership stay put. */}
        <div
          data-slot="communication-overview"
          className="flex h-full min-h-0 flex-col overflow-hidden"
        >
          <header className="shrink-0 pb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Communication Hub
                </h1>
                {/* The header is capability-matched too (#666): a Member holds no
                  `communication.send`, and "Send messages…" is an instruction
                  for a write the server refuses them. */}
                <p className="text-muted-foreground">
                  {communicationHubSubtitle(canSend)}
                </p>
              </div>
              {canSend && (
                <Button asChild className="sm:shrink-0">
                  <Link href="/communication/compose">
                    <Plus className="mr-2 h-4 w-4" />
                    New Message
                  </Link>
                </Button>
              )}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-auto pb-1">
            <div className="grid gap-6 md:grid-cols-3">
              {/* Stats Cards */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Total Messages
                  </CardTitle>
                  <Mail className="text-muted-foreground h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{total}</div>
                  {loggedCount > 0 && (
                    <Link
                      href="/communication/history?status=logged"
                      className="text-muted-foreground hover:text-foreground mt-1 inline-block cursor-pointer text-xs underline-offset-4 hover:underline"
                    >
                      {loggedCount === 1
                        ? "Includes 1 logged contact"
                        : `Includes ${loggedCount} logged contacts`}
                    </Link>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Sent This Week
                  </CardTitle>
                  <Send className="text-muted-foreground h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{sentThisWeek}</div>
                  {loggedCount > 0 && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Logged contacts are not counted here.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Templates Available
                  </CardTitle>
                  <Mail className="text-muted-foreground h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{templates.length}</div>
                </CardContent>
              </Card>
            </div>

            {/* Delivery performance (COM-019) */}
            <div className="mt-6">
              <DeliveryOverview totals={deliveryTotals} canSend={canSend} />
            </div>

            {/* Quick Actions — every card is a link INTO the compose form with a
              template preloaded, so the whole block is one write affordance
              wearing four faces. The templates themselves stay readable at
              /communication/templates. */}
            {canSend && quickActions.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-3 text-lg font-semibold">Quick Actions</h2>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  {quickActions.map((template) => (
                    <Link
                      key={template.id}
                      href={`/communication/compose?templateId=${template.id}`}
                      className="cursor-pointer"
                    >
                      <Card className="cursor-pointer transition-shadow hover:shadow-md">
                        <CardContent className="p-4">
                          <p className="font-medium">{template.name}</p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {template.description}
                          </p>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Messages */}
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Recent Messages</h2>
                <Link
                  href="/communication/history"
                  className="text-primary cursor-pointer text-sm hover:underline"
                >
                  View All Messages
                </Link>
              </div>
              {recentMessages.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Mail className="text-muted-foreground mb-4 h-12 w-12" />
                    <p className="text-muted-foreground text-lg font-medium">
                      No messages yet
                    </p>
                    {/* The fact is the same for everybody; the sentence under it
                      states who sends messages rather than asking a viewer who
                      cannot to send one. */}
                    <p className="text-muted-foreground mt-1 text-sm">
                      {communicationEmptyStateLine(canSend)}
                    </p>
                    {canSend && (
                      <Button asChild className="mt-4">
                        <Link href="/communication/compose">
                          <Plus className="mr-2 h-4 w-4" />
                          Compose Message
                        </Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {recentMessages.map((msg) => (
                    <Link
                      key={msg.id}
                      href={`/communication/${msg.id}`}
                      className="cursor-pointer"
                    >
                      <Card className="cursor-pointer transition-shadow hover:shadow-md">
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                              {resolvedSubjectMap.get(msg.id) ??
                                msg.subject ??
                                "(No subject)"}
                            </p>
                            <p className="text-muted-foreground mt-1 text-sm">
                              {msg.recipientCount ?? 0} recipient
                              {(msg.recipientCount ?? 0) !== 1 ? "s" : ""}
                              {msg.sentAt &&
                                ` · ${formatRelativeTimestamp(msg.sentAt, now, timeZone)}`}
                            </p>
                          </div>
                          <Badge
                            variant="secondary"
                            className={communicationStatusBadgeClass(
                              msg.status
                            )}
                          >
                            {communicationStatusLabel(msg.status)}
                          </Badge>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </PageCanvas>
    </>
  );
}
