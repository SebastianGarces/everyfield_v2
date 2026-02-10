import { Mail, Plus, Send } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { verifySession } from "@/lib/auth/session";
import { getCommunications, resolveSubjects } from "@/lib/communication/service";
import { getTemplates } from "@/lib/communication/templates";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

const statusColors: Record<string, string> = {
  sent: "bg-green-100 text-green-700",
  sending: "bg-blue-100 text-blue-700",
  draft: "bg-gray-100 text-gray-700",
  failed: "bg-red-100 text-red-700",
  scheduled: "bg-yellow-100 text-yellow-700",
};

export default async function CommunicationPage() {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const [{ communications: recentMessages, total }, templates] =
    await Promise.all([
      getCommunications(user.churchId, { limit: 10 }),
      getTemplates(user.churchId),
    ]);

  // Resolve merge field variables in subjects for display
  const resolvedSubjectMap = await resolveSubjects(user.churchId, recentMessages);

  // Quick action templates (show first 4 system/popular templates)
  const quickActions = templates
    .filter((t) => t.isSystem)
    .slice(0, 4);

  const sentThisWeek = recentMessages.filter((m) => {
    if (!m.sentAt) return false;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return m.sentAt > weekAgo;
  }).length;

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Communication" }]} />
      <div className="flex h-full flex-col">
        <div className="bg-card space-y-6 p-6 pb-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Communication Hub
              </h1>
              <p className="text-foreground/50">
                Send messages and track communication with your people
              </p>
            </div>
            <Button asChild>
              <Link href="/communication/compose">
                <Plus className="mr-2 h-4 w-4" />
                New Message
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
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

          {/* Quick Actions */}
          {quickActions.length > 0 && (
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
                  <p className="text-muted-foreground mt-1 text-sm">
                    Send your first message to get started
                  </p>
                  <Button asChild className="mt-4">
                    <Link href="/communication/compose">
                      <Plus className="mr-2 h-4 w-4" />
                      Compose Message
                    </Link>
                  </Button>
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
                            {resolvedSubjectMap.get(msg.id) ?? msg.subject ?? "(No subject)"}
                          </p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {msg.recipientCount ?? 0} recipient
                            {(msg.recipientCount ?? 0) !== 1 ? "s" : ""}
                            {msg.sentAt &&
                              ` · ${formatDistanceToNow(msg.sentAt)}`}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className={statusColors[msg.status] ?? ""}
                        >
                          {msg.status}
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
    </>
  );
}
