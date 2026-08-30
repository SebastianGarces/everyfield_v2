"use client";

import Link from "next/link";
import {
  createContext,
  forwardRef,
  useContext,
  type ComponentProps,
} from "react";

type EvryNavigationIntent = (href: string) => void;

const EvryNavigationIntentContext = createContext<EvryNavigationIntent>(
  () => undefined
);

export const EvryNavigationIntentProvider =
  EvryNavigationIntentContext.Provider;

export type EvryLinkProps = Omit<ComponentProps<typeof Link>, "href"> &
  Readonly<{ href: string }>;

/**
 * Product-owned boundary for Next Link navigation. Next 16 dispatches App
 * Router Link actions directly, so an AppRouterContext wrapper cannot observe
 * them. `onNavigate` is the exact accepted same-window navigation seam: Next
 * omits it for modified, download, and new-context clicks.
 */
export const EvryLink = forwardRef<HTMLAnchorElement, EvryLinkProps>(
  function EvryLink({ href, onNavigate, ...props }, ref) {
    const recordNavigationIntent = useContext(EvryNavigationIntentContext);
    return (
      <Link
        {...props}
        ref={ref}
        href={href}
        onNavigate={(event) => {
          let prevented = false;
          onNavigate?.({
            preventDefault: () => {
              prevented = true;
              event.preventDefault();
            },
          });
          if (!prevented) recordNavigationIntent(href);
        }}
      />
    );
  }
);
