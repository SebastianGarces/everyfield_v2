import { redirect } from "next/navigation";
import Link from "next/link";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { HistoryFilters } from "@/components/communication/history-filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, SearchX } from "lucide-react";
import { getCurrentUserChurch, verifySession } from "@/lib/auth/session";
import {
  getCommunications,
  resolveSubjects,
} from "@/lib/communication/service";
import {
  communicationStatusBadgeClass,
  communicationStatusLabel,
} from "@/lib/communication/status-display";
import { parseCommunicationFilters } from "@/lib/validations/communication";
// Dates render through the pinned-zone formatter, never date-fns —
// memory/invariants.md → Date & Time Rendering (ruled 2026-08-12, 407-3-1).
import {
  DEFAULT_CHURCH_TIME_ZONE,
  formatRelativeTimestamp,
} from "@/lib/datetime";

export const dynamic = "force-dynamic";

interface HistoryPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const channelLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  both: "Email + SMS",
};

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  // One `now` per render: every row's relative label is measured against the
  // same instant, so a list can never show times that disagree with each other.
  const now = new Date();

  const params = await searchParams;
  // Unparseable values are dropped, not thrown: a hand-edited or stale URL must
  // degrade to a wider result set, never to an error page.
  const filters = parseCommunicationFilters(params);
  const { page, limit } = filters;

  const [church, { communications, total }] = await Promise.all([
    getCurrentUserChurch(),
    getCommunications(user.churchId, filters),
  ]);

  // Resolve merge field variables in subjects for display
  const resolvedSubjectMap = await resolveSubjects(
    user.churchId,
    communications
  );

  const timeZone = church?.timeZone ?? DEFAULT_CHURCH_TIME_ZONE;

  const totalPages = Math.ceil(total / limit);
  const hasFilters = Boolean(
    filters.channel || filters.status || filters.search
  );

  function pageHref(target: number) {
    const query = new URLSearchParams();
    if (filters.channel) query.set("channel", filters.channel);
    if (filters.status) query.set("status", filters.status);
    if (filters.search) query.set("search", filters.search);
    if (target > 1) query.set("page", String(target));
    const queryString = query.toString();
    return queryString
      ? `/communication/history?${queryString}`
      : "/communication/history";
  }

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Communication", href: "/communication" },
          { label: "Message History" },
        ]}
      />
      <PageCanvas className="overflow-hidden">
        <WorkspacePanel className="flex h-full flex-col overflow-hidden">
          <div className="border-b p-4 pb-4 sm:p-6 sm:pb-4">
            <h1 className="text-3xl font-bold tracking-tight">
              Message History
            </h1>
            <p className="text-muted-foreground" data-testid="history-count">
              {hasFilters
                ? `${total} matching ${total === 1 ? "message" : "messages"}`
                : `All sent messages · ${total} total`}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
            <div className="mb-4">
              <HistoryFilters />
            </div>

            {communications.length === 0 ? (
              <Card>
                <CardContent
                  className="flex flex-col items-center justify-center py-12"
                  data-testid="history-empty-state"
                >
                  {hasFilters ? (
                    <>
                      <SearchX
                        className="text-muted-foreground mb-4 h-12 w-12"
                        aria-hidden="true"
                      />
                      <p className="text-muted-foreground text-lg">
                        No messages match these filters
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className="mt-4"
                      >
                        <Link
                          href="/communication/history"
                          className="cursor-pointer"
                        >
                          Clear filters
                        </Link>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Mail
                        className="text-muted-foreground mb-4 h-12 w-12"
                        aria-hidden="true"
                      />
                      <p className="text-muted-foreground text-lg">
                        No messages sent yet
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Messages table */}
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full" data-testid="history-table">
                    <thead>
                      <tr className="bg-muted/50 text-muted-foreground border-b text-left text-sm font-medium">
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Subject</th>
                        <th className="px-4 py-3 text-center">Recipients</th>
                        <th className="px-4 py-3 text-center">Channel</th>
                        <th className="px-4 py-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {communications.map((msg) => (
                        <tr
                          key={msg.id}
                          className="hover:bg-muted/40 border-b last:border-0"
                          data-testid="history-row"
                          data-channel={msg.channel}
                          data-status={msg.status}
                        >
                          <td className="px-4 py-3 text-sm">
                            {msg.sentAt
                              ? formatRelativeTimestamp(
                                  msg.sentAt,
                                  now,
                                  timeZone
                                )
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/communication/${msg.id}`}
                              className="cursor-pointer font-medium hover:underline"
                            >
                              {resolvedSubjectMap.get(msg.id) ??
                                msg.subject ??
                                "(No subject)"}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-center text-sm">
                            {msg.recipientCount ?? 0}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant="secondary" className="text-xs">
                              {channelLabels[msg.channel] ?? msg.channel}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              variant="secondary"
                              className={communicationStatusBadgeClass(
                                msg.status
                              )}
                            >
                              {communicationStatusLabel(msg.status)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-muted-foreground text-sm">
                      Page {page} of {totalPages}
                    </p>
                    <div className="flex gap-2">
                      {page > 1 && (
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            href={pageHref(page - 1)}
                            className="cursor-pointer"
                          >
                            Previous
                          </Link>
                        </Button>
                      )}
                      {page < totalPages && (
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            href={pageHref(page + 1)}
                            className="cursor-pointer"
                          >
                            Next
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
