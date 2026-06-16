import Link from "next/link";

import { HeaderBreadcrumbs } from "@/components/header";
import {
  FeedbackStatusFilter,
  FeedbackStatusSelect,
} from "@/components/admin/feedback";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  feedbackCategories,
  feedbackStatuses,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { listFeedback } from "@/lib/feedback/service";

export const dynamic = "force-dynamic";

interface AdminFeedbackPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function parseStatus(value: unknown): FeedbackStatus | undefined {
  return typeof value === "string" &&
    (feedbackStatuses as readonly string[]).includes(value)
    ? (value as FeedbackStatus)
    : undefined;
}

function parseCategory(value: unknown): FeedbackCategory | undefined {
  return typeof value === "string" &&
    (feedbackCategories as readonly string[]).includes(value)
    ? (value as FeedbackCategory)
    : undefined;
}

const categoryVariant: Record<
  FeedbackCategory,
  "default" | "secondary" | "destructive" | "outline"
> = {
  bug: "destructive",
  suggestion: "default",
  question: "secondary",
  other: "outline",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function AdminFeedbackPage({
  searchParams,
}: AdminFeedbackPageProps) {
  // Page-level guard: non-admins get notFound().
  await requirePlatformAdmin();

  const params = await searchParams;
  const status = parseStatus(params.status);
  const category = parseCategory(params.category);
  const page =
    typeof params.page === "string" ? Number.parseInt(params.page, 10) || 1 : 1;

  const { items, page: currentPage, hasNextPage } = await listFeedback({
    status,
    category,
    page,
  });

  const buildPageHref = (targetPage: number) => {
    const next = new URLSearchParams();
    if (status) next.set("status", status);
    if (category) next.set("category", category);
    if (targetPage > 1) next.set("page", String(targetPage));
    const qs = next.toString();
    return qs ? `/admin/feedback?${qs}` : "/admin/feedback";
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <HeaderBreadcrumbs items={[{ label: "Admin" }, { label: "Feedback" }]} />

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
        <p className="text-muted-foreground text-sm">
          Triage user-submitted feedback across all churches.
        </p>
      </div>

      <FeedbackStatusFilter activeStatus={status} category={category} />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Date</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Church</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Page</TableHead>
              <TableHead className="min-w-72">Description</TableHead>
              <TableHead className="w-44">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-muted-foreground py-10 text-center"
                >
                  No feedback found.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap text-sm">
                    {dateFormatter.format(item.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="font-medium">
                      {item.userName ?? "Unknown"}
                    </div>
                    <div className="text-muted-foreground">
                      {item.userEmail}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.churchName ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={categoryVariant[item.category]}>
                      {item.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-sm">
                    {item.pageUrl ? (
                      <span title={item.pageUrl}>{item.pageUrl}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {/* Rendered as plain text — no HTML/markdown interpretation. */}
                    <p className="max-w-md whitespace-pre-wrap break-words">
                      {item.description}
                    </p>
                  </TableCell>
                  <TableCell>
                    <FeedbackStatusSelect
                      id={item.id}
                      status={item.status}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">Page {currentPage}</p>
        <div className="flex items-center gap-2">
          {currentPage > 1 ? (
            <Link
              href={buildPageHref(currentPage - 1)}
              className="hover:bg-accent cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              Previous
            </Link>
          ) : (
            <span className="text-muted-foreground rounded-md border px-3 py-1.5 text-sm font-medium opacity-50">
              Previous
            </span>
          )}
          {hasNextPage ? (
            <Link
              href={buildPageHref(currentPage + 1)}
              className="hover:bg-accent cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              Next
            </Link>
          ) : (
            <span className="text-muted-foreground rounded-md border px-3 py-1.5 text-sm font-medium opacity-50">
              Next
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
