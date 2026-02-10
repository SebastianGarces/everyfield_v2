import { notFound } from "next/navigation";
import { format } from "date-fns";
import { CalendarDays, MapPin, Check, X } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  getConfirmationDetails,
} from "@/lib/communication/confirmation";
import { RsvpActions } from "./rsvp-actions";

interface RsvpPageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Public-facing RSVP page. No authentication required.
 * Displays meeting details and confirm/decline buttons.
 */
export default async function RsvpPage({
  params,
  searchParams,
}: RsvpPageProps) {
  const { token } = await params;
  const sp = await searchParams;
  const action = sp.action === "decline" ? "decline" : undefined;

  const details = await getConfirmationDetails(token);
  if (!details) notFound();

  const { meeting, person, church, token: tokenRecord } = details;
  const isExpired = tokenRecord.expiresAt < new Date();
  const hasResponded = tokenRecord.status !== "pending";

  const meetingTypeLabels: Record<string, string> = {
    vision_meeting: "Vision Meeting",
    orientation: "Orientation",
    team_meeting: "Team Meeting",
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="p-8">
          {/* Church + meeting header */}
          <div className="mb-6 text-center">
            <p className="text-muted-foreground text-sm font-medium">
              {church.name}
            </p>
            <h1 className="mt-2 text-2xl font-bold">
              {meeting.title ??
                meetingTypeLabels[meeting.type] ??
                meeting.type}
            </h1>
          </div>

          {/* Meeting details */}
          <div className="mb-6 space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <CalendarDays className="text-muted-foreground h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-medium">
                  {format(meeting.datetime, "EEEE, MMMM d, yyyy")}
                </p>
                <p className="text-muted-foreground">
                  {format(meeting.datetime, "h:mm a")}
                </p>
              </div>
            </div>

            {(meeting.locationName || meeting.locationAddress) && (
              <div className="flex items-center gap-3 text-sm">
                <MapPin className="text-muted-foreground h-5 w-5 flex-shrink-0" />
                <div>
                  {meeting.locationName && (
                    <p className="font-medium">{meeting.locationName}</p>
                  )}
                  {meeting.locationAddress && (
                    <p className="text-muted-foreground">
                      {meeting.locationAddress}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Greeting */}
          <p className="text-muted-foreground mb-6 text-center text-sm">
            Hi {person.firstName}, will you be attending?
          </p>

          {/* Response state */}
          {isExpired ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
              <p className="font-medium text-amber-800">
                This RSVP link has expired
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Please contact {church.name} for an updated link.
              </p>
            </div>
          ) : hasResponded ? (
            <div
              className={`rounded-lg border p-4 text-center ${
                tokenRecord.status === "confirmed"
                  ? "border-green-200 bg-green-50"
                  : "border-red-200 bg-red-50"
              }`}
            >
              <div className="mb-2 flex justify-center">
                {tokenRecord.status === "confirmed" ? (
                  <Check className="h-8 w-8 text-green-600" />
                ) : (
                  <X className="h-8 w-8 text-red-600" />
                )}
              </div>
              <p
                className={`font-medium ${
                  tokenRecord.status === "confirmed"
                    ? "text-green-800"
                    : "text-red-800"
                }`}
              >
                {tokenRecord.status === "confirmed"
                  ? "You've confirmed your attendance!"
                  : "You've declined this invitation"}
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Your response has been recorded. Thank you!
              </p>
            </div>
          ) : (
            <RsvpActions token={token} autoAction={action} />
          )}

          {/* Footer */}
          <p className="text-muted-foreground mt-6 text-center text-xs">
            Powered by EveryField
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
