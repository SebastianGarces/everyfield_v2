"use client";

import { AppError } from "@/components/app-error";

/**
 * Error boundary for all dashboard routes — the CLOSE one.
 *
 * It catches inside the `(dashboard)` layout, so the sidebar, the breadcrumb
 * and the chrome survive and the message appears where the page was.
 * `src/app/error.tsx` is the same panel one segment up, for the throws this one
 * cannot see (the layout's own, including the sidebar's Send Feedback button).
 * The panel itself — copy, discriminator, Sentry — lives in one place.
 */
export default function DashboardError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppError {...props} />;
}
