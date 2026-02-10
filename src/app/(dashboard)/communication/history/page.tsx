import { redirect } from "next/navigation";
import Link from "next/link";

import { HeaderBreadcrumbs } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { verifySession } from "@/lib/auth/session";
import { getCommunications, resolveSubjects } from "@/lib/communication/service";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

interface HistoryPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const statusColors: Record<string, string> = {
  sent: "bg-green-100 text-green-700",
  sending: "bg-blue-100 text-blue-700",
  draft: "bg-gray-100 text-gray-700",
  failed: "bg-red-100 text-red-700",
  scheduled: "bg-yellow-100 text-yellow-700",
};

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const params = await searchParams;
  const page = typeof params.page === "string" ? parseInt(params.page, 10) : 1;

  const { communications, total } = await getCommunications(user.churchId, {
    page,
    limit: 20,
  });

  // Resolve merge field variables in subjects for display
  const resolvedSubjectMap = await resolveSubjects(user.churchId, communications);

  const totalPages = Math.ceil(total / 20);

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Communication", href: "/communication" },
          { label: "Message History" },
        ]}
      />
      <div className="flex h-full flex-col">
        <div className="bg-card p-6 pb-4 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight">
            Message History
          </h1>
          <p className="text-foreground/50">
            All sent messages · {total} total
          </p>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {communications.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Mail className="text-muted-foreground mb-4 h-12 w-12" />
                <p className="text-muted-foreground text-lg">
                  No messages sent yet
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Messages table */}
              <div className="rounded-lg border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-gray-50 text-left text-sm font-medium text-gray-500">
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
                        className="border-b last:border-0 hover:bg-gray-50"
                      >
                        <td className="px-4 py-3 text-sm">
                          {msg.sentAt
                            ? formatDistanceToNow(msg.sentAt, {
                                addSuffix: true,
                              })
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/communication/${msg.id}`}
                            className="cursor-pointer font-medium hover:underline"
                          >
                            {resolvedSubjectMap.get(msg.id) ?? msg.subject ?? "(No subject)"}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-center text-sm">
                          {msg.recipientCount ?? 0}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="secondary" className="text-xs">
                            {msg.channel === "email" ? "Email" : msg.channel}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            variant="secondary"
                            className={statusColors[msg.status] ?? ""}
                          >
                            {msg.status}
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
                          href={`/communication/history?page=${page - 1}`}
                          className="cursor-pointer"
                        >
                          Previous
                        </Link>
                      </Button>
                    )}
                    {page < totalPages && (
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          href={`/communication/history?page=${page + 1}`}
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
      </div>
    </>
  );
}
