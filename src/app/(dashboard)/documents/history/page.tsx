import { FileText } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HistoryDownloadButton } from "@/components/documents/history-download-button";
import { HeaderBreadcrumbs } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { verifySession } from "@/lib/auth/session";
import { formatDateWithoutWeekday } from "@/lib/datetime";
import { FORMAT_LABELS } from "@/lib/documents";
import { listGeneratedDocuments } from "@/lib/documents/service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Generated documents",
};

export default async function GeneratedDocumentsHistoryPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const documents = await listGeneratedDocuments(user.churchId);

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Documents", href: "/documents" },
          { label: "History" },
        ]}
      />
      <div className="flex h-full flex-col">
        <div className="bg-card space-y-1 p-6 pb-4 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight">
            My Generated Documents
          </h1>
          <p className="text-muted-foreground">
            Re-download a document you have already generated, without creating
            it again.
          </p>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
              <FileText className="text-muted-foreground h-10 w-10" />
              <div className="space-y-1">
                <p className="font-medium">No documents generated yet</p>
                <p className="text-muted-foreground text-sm">
                  Generate a template and it will show up here.
                </p>
              </div>
              <Button asChild className="cursor-pointer">
                <Link href="/documents">Browse templates</Link>
              </Button>
            </div>
          ) : (
            <Table data-testid="document-history">
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((document) => {
                  const filename = `${document.templateName}`;
                  return (
                    <TableRow key={document.id}>
                      <TableCell className="font-medium">{filename}</TableCell>
                      <TableCell>{document.templateName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {FORMAT_LABELS[document.format]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatDateWithoutWeekday(document.createdAt, "short")}
                      </TableCell>
                      <TableCell className="text-right">
                        <HistoryDownloadButton
                          artifactId={document.id}
                          label={filename}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}
