import { redirect } from "next/navigation";
import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { format } from "date-fns";

import { PersonProfileWrapper } from "@/components/people/person-profile-wrapper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { verifySession } from "@/lib/auth/session";
import { getPersonCommunications } from "@/lib/communication/service";

interface CommunicationPageProps {
  params: Promise<{ id: string }>;
}

const statusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  delivered: "bg-green-100 text-green-700",
  opened: "bg-emerald-100 text-emerald-700",
  clicked: "bg-teal-100 text-teal-700",
  bounced: "bg-red-100 text-red-700",
  failed: "bg-red-100 text-red-700",
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
            <Link
              href={`/communication/compose`}
              className="cursor-pointer"
            >
              <Send className="mr-1 h-3 w-3" />
              Send Message
            </Link>
          </Button>
        </div>

        {history.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Mail className="text-muted-foreground mb-4 h-10 w-10" />
              <p className="text-muted-foreground">
                No messages sent to this person yet
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {history.map(({ communication, recipient }) => (
              <Link
                key={recipient.id}
                href={`/communication/${communication.id}`}
                className="cursor-pointer"
              >
                <Card className="cursor-pointer transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {communication.subject ?? "(No subject)"}
                      </p>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {communication.sentAt
                          ? format(communication.sentAt, "MMM d, yyyy 'at' h:mm a")
                          : "—"}
                      </p>
                    </div>
                    <div className="ml-4 flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={statusColors[recipient.status] ?? ""}
                      >
                        {recipient.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PersonProfileWrapper>
  );
}
