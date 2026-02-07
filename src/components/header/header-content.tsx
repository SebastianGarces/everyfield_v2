"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useHeader, type HeaderBreadcrumbItem } from "./header-context";

/**
 * Declaratively sets the header breadcrumbs for the current page.
 * Place this component anywhere in your page — it renders nothing visually.
 *
 * @example
 * <HeaderBreadcrumbs items={[
 *   { label: "People & CRM", href: "/people" },
 *   { label: "John Doe" },
 * ]} />
 */
export function HeaderBreadcrumbs({
  items,
}: {
  items: HeaderBreadcrumbItem[];
}) {
  const { setBreadcrumbs } = useHeader();

  useEffect(() => {
    setBreadcrumbs(items);
    return () => setBreadcrumbs([]);
  }, [items, setBreadcrumbs]);

  return null;
}

/**
 * Portals children into the header's right-side actions area.
 * Place this component anywhere in your page — children will render in the header.
 *
 * @example
 * <HeaderActions>
 *   <Button variant="outline">Export</Button>
 *   <Button>Save</Button>
 * </HeaderActions>
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const { actionsContainer } = useHeader();

  if (!actionsContainer) return null;

  return createPortal(children, actionsContainer);
}
