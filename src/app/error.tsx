"use client";

import { AppError } from "@/components/app-error";

/**
 * The app-wide error boundary — the one that catches a LAYOUT.
 *
 * `error.tsx` wraps its segment's children, never the layout beside it, so
 * `(dashboard)/error.tsx` cannot catch a throw from the dashboard layout. The
 * sidebar is part of that layout and holds the Send Feedback button; once
 * `submitFeedbackAction` began rethrowing the sessionless refusal (#508), that
 * press fell straight past the nested boundary to `global-error.tsx` and
 * rendered Next's bare "Application error: a client-side exception has
 * occurred" — the exact blank-page failure #498 added a boundary to end.
 *
 * This is the parent segment's boundary, so the dashboard layout is inside it.
 * `global-error.tsx` still sits above, for a throw in the ROOT layout, where
 * even `<body>` cannot be assumed.
 */
export default function AppRouteError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AppError {...props} />;
}
