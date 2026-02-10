"use client";

import Link from "next/link";
import {
  Mail,
  CheckCheck,
  Eye,
  ExternalLink,
  Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import {
  renderTemplate,
  buildChurchMergeData,
  buildMeetingMergeData,
} from "@/lib/communication/merge";

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
  meetingId: string;
  communications: CommunicationSummary[];
  church: { name: string };
  meeting: {
    title: string | null;
    type: string;
    datetime: string;
    locationName: string | null;
    locationAddress: string | null;
  };
}

export function MeetingCommunicationStatus({
  meetingId,
  communications,
  church,
  meeting,
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
              <Link
                href={`/communication/compose?meetingId=${meetingId}`}
                className="cursor-pointer"
              >
                <Send className="mr-2 h-4 w-4" />
                Send Email
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
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
            <Link
              href={`/communication/compose?meetingId=${meetingId}`}
              className="cursor-pointer"
            >
              <Send className="mr-2 h-4 w-4" />
              New Email
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {communications.map((comm) => {
          const resolvedSubject = comm.subject
            ? renderTemplate(comm.subject, mergeData)
            : "(No subject)";
          const issues = comm.stats.bounced + comm.stats.failed;

          return (
            <Link
              key={comm.id}
              href={`/communication/${comm.id}`}
              className="cursor-pointer flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {resolvedSubject}
                </p>
                <p className="text-xs text-muted-foreground">
                  {comm.sentAt
                    ? format(new Date(comm.sentAt), "MMM d, yyyy 'at' h:mm a")
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
                  <TooltipContent>
                    {comm.stats.opened} opened
                  </TooltipContent>
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
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
