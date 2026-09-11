"use client";

import Link from "next/link";
import {
  createContext,
  forwardRef,
  useContext,
  type ComponentProps,
} from "react";

type AuthenticatedNavigationIntent = (href: string) => void;

const AuthenticatedNavigationIntentContext =
  createContext<AuthenticatedNavigationIntent>(() => undefined);

export const AuthenticatedNavigationIntentProvider =
  AuthenticatedNavigationIntentContext.Provider;

export function useAuthenticatedNavigationIntent(): AuthenticatedNavigationIntent {
  return useContext(AuthenticatedNavigationIntentContext);
}

export type AuthenticatedLinkProps = Omit<ComponentProps<typeof Link>, "href"> &
  Readonly<{ href: string }>;

/**
 * Product-owned boundary for accepted Next Link navigation inside the
 * persistent authenticated shell. Next 16 dispatches Link actions directly,
 * so an AppRouterContext wrapper cannot observe them. `onNavigate` is the
 * exact same-window seam after Next filters modified, download, and
 * new-context clicks.
 */
export const AuthenticatedLink = forwardRef<
  HTMLAnchorElement,
  AuthenticatedLinkProps
>(function AuthenticatedLink({ href, onNavigate, ...props }, ref) {
  const recordNavigationIntent = useAuthenticatedNavigationIntent();
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
});
