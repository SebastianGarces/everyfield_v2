"use client";

import Link from "next/link";
import { Mail, CheckCheck, Eye, ExternalLink, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  renderSubject,
  buildChurchMergeData,
  buildMeetingMergeData,
} from "@/lib/communication/merge";
// date-fns `format` renders in the runtime's zone, which differs between the
// SSR pass and the browser — one more React #418 on this page. See
// src/lib/datetime.ts.
import { formatDateTime } from "@/lib/datetime";

interface CommunicationSummary {
  id: string;
  subject: string | null;
  body: string;
  sentAt: string | null;
  stats: {
    total: number;
    sent: number;
    delivered: number;
    opened: number;
    bounced: number;
    failed: number;
  };
}

interface MeetingCommunicationStatusProps {
  communications: CommunicationSummary[];
  church: { name: string };
  timeZone: string;
  meeting: {
    title: string | null;
    type: string;
    datetime: string;
    locationName: string | null;
    locationAddress: string | null;
    /** `church_meetings.agenda` as stored — parsed by `buildMeetingMergeData`. */
    agenda: unknown;
  };
  /**
   * Where Send Email goes — `meetingComposeUrl`, built by the page.
   *
   * A URL and not the guest list, though this card is the reason the guests are
   * read at all: the page is a server component that already holds them, and
   * handing a `"use client"` component every guest's ADDRESS so it can compute
   * one string puts those addresses in the RSC payload for nothing. The guest
   * list's own button takes the guests, because it renders them.
   *
   * This link used to carry `meetingId` alone while that button one tab away
   * carried `meetingId` AND `recipientIds` — two Send Email buttons on one
   * meeting, one of which opened an empty compose screen (#612). Both ends of
   * the same builder now, so the difference cannot come back.
   */
  composeUrl: string;
}

export function MeetingCommunicationStatus({
  communications,
  church,
  timeZone,
  meeting,
  composeUrl,
}: MeetingCommunicationStatusProps) {
  const mergeData = {
    ...buildChurchMergeData(church),
    ...buildMeetingMergeData({
      ...meeting,
      datetime: new Date(meeting.datetime),
    }),
  };

  if (communications.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Communications</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href={composeUrl} className="cursor-pointer">
                <Send className="mr-2 h-4 w-4" />
                Send Email
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No communications sent for this meeting yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Communications ({communications.length})
          </CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href={composeUrl} className="cursor-pointer">
              <Send className="mr-2 h-4 w-4" />
              New Email
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {communications.map((comm) => {
          const resolvedSubject = comm.subject
            ? renderSubject(comm.subject, mergeData)
            : "(No subject)";
          const issues = comm.stats.bounced + comm.stats.failed;

          return (
            <Link
              key={comm.id}
              href={`/communication/${comm.id}`}
              className="hover:bg-muted/50 flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {resolvedSubject}
                </p>
                <p className="text-muted-foreground text-xs">
                  {comm.sentAt
                    ? formatDateTime(new Date(comm.sentAt), "short", timeZone)
                    : "Draft"}
                </p>
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 text-xs text-blue-600">
                      <Mail className="h-3.5 w-3.5" />
                      {comm.stats.sent}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {comm.stats.sent} of {comm.stats.total} sent
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCheck className="h-3.5 w-3.5" />
                      {comm.stats.delivered}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {comm.stats.delivered} delivered
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 text-xs text-emerald-600">
                      <Eye className="h-3.5 w-3.5" />
                      {comm.stats.opened}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{comm.stats.opened} opened</TooltipContent>
                </Tooltip>

                {issues > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Badge variant="destructive" className="text-xs">
                          {issues} failed
                        </Badge>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {comm.stats.bounced} bounced, {comm.stats.failed} failed
                    </TooltipContent>
                  </Tooltip>
                )}
                <ExternalLink className="text-muted-foreground h-3.5 w-3.5" />
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
