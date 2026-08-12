import { redirect } from "next/navigation";
import Link from "next/link";
import { Mail, Send } from "lucide-react";

import { PersonProfileWrapper } from "@/components/people/person-profile-wrapper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { verifySession } from "@/lib/auth/session";
import { getPersonCommunications } from "@/lib/communication/service";
import { formatDateTime } from "@/lib/datetime";
import {
  COMMUNICATION_STATUS_BADGE_CLASSES,
  COMMUNICATION_STATUS_LABELS,
  LOGGED_ENTRY_NOTE,
} from "@/lib/communication/status-display";

interface CommunicationPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Delivery states, which describe an email that left the system.
 *
 * A COM-020 logged contact never uses this map. Its recipient row is `sent` on
 * purpose — the contact WAS made — so reading the recipient's status alone
 * would show a blue "Sent" pill for a contact where nothing was sent. The badge
 * below therefore branches on `communication.status` first.
 */
const recipientStatusStyles: Record<
  string,
  { label: string; className: string }
> = {
  pending: { label: "Pending", className: "bg-gray-100 text-gray-600" },
  sent: { label: "Sent", className: "bg-blue-100 text-blue-700" },
  delivered: { label: "Delivered", className: "bg-green-100 text-green-700" },
  opened: { label: "Opened", className: "bg-emerald-100 text-emerald-700" },
  clicked: { label: "Clicked", className: "bg-teal-100 text-teal-700" },
  bounced: { label: "Bounced", className: "bg-red-100 text-red-700" },
  failed: { label: "Failed", className: "bg-red-100 text-red-700" },
};

export default async function PersonCommunicationPage({
  params,
}: CommunicationPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const { id } = await params;
  const history = await getPersonCommunications(user.churchId, id);

  return (
    <PersonProfileWrapper personId={id} activeTab="communication">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Communication Log</h2>
          <Button size="sm" asChild>
            <Link href={`/communication/compose`} className="cursor-pointer">
              <Send className="mr-1 h-3 w-3" />
              Send Message
            </Link>
          </Button>
        </div>

        {history.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Mail className="text-muted-foreground mb-4 h-10 w-10" />
              <p className="font-medium">No contact recorded yet</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Messages you send and tasks you complete about this person
                appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {history.map(({ communication, recipient }) => {
              const isLoggedContact = communication.status === "logged";
              const delivery = recipientStatusStyles[recipient.status];

              return (
                <Link
                  key={recipient.id}
                  href={`/communication/${communication.id}`}
                  className="cursor-pointer"
                >
                  <Card className="cursor-pointer transition-shadow hover:shadow-md">
                    <CardContent className="flex items-start justify-between p-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {communication.subject ?? "(No subject)"}
                        </p>
                        <p className="text-muted-foreground mt-1 text-sm">
                          {communication.sentAt
                            ? formatDateTime(communication.sentAt, "short")
                            : "—"}
                        </p>
                        {isLoggedContact && (
                          <p className="text-muted-foreground mt-1 text-xs">
                            {LOGGED_ENTRY_NOTE}
                          </p>
                        )}
                      </div>
                      <div className="ml-4 flex items-center gap-2">
                        {isLoggedContact ? (
                          <Badge
                            variant="secondary"
                            className={
                              COMMUNICATION_STATUS_BADGE_CLASSES.logged
                            }
                          >
                            {COMMUNICATION_STATUS_LABELS.logged}
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className={delivery?.className ?? ""}
                          >
                            {delivery?.label ?? recipient.status}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </PersonProfileWrapper>
  );
}
