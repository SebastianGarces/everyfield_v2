import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Not-found boundary for all dashboard routes. Covers `notFound()` calls from
 * dashboard pages and guards — e.g. a non-admin hitting `/admin/feedback`,
 * which 404s rather than leaking that the admin route exists.
 */
export default function DashboardNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-muted-foreground text-sm font-medium">404</p>
      <h2 className="text-2xl font-bold">Page not found</h2>
      <p className="text-muted-foreground max-w-sm">
        This page doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
