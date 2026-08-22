"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Capability } from "@/lib/auth/seat-rules";

// ----------------------------------------------------------------------------
// WHAT THE VIEWER MAY DO, ASKED BY NAME FROM ANY DEPTH — the client half of
// AS-020 (#499).
//
// The list is computed ONCE per request by `heldCapabilities`
// (`@/lib/auth/seat-rules`) out of the same capability table `requireSeat`
// reads, and seeded in the dashboard layout. Nothing here decides anything:
// this file is transport, so a control's visibility and the server's refusal
// can never disagree about a verb.
//
// WHY A CONTEXT AND NOT A PROP. Every alternative threads one boolean through
// layers that have no other reason to know about seats — `page.tsx` →
// `PipelineWrapper` → `PipelineView` → `PipelineColumn` → `PipelineCard` for
// one drag handle, and a comparable chain for a task row. That is the signal
// threading the Laziness Protocol tells you to stop and find a direct path
// around, and it re-states the same decision at every hop. A component that
// renders a write control asks for the verb it is about to invoke, in the file
// that renders it, where a reviewer can see both at once.
//
// A SERVER COMPONENT DOES NOT USE THIS. It holds the session already, so it
// calls `holdsSeatFor(user, capability)` and renders or does not. That is the
// established pattern (`/oversight/invitations/page.tsx`, `team-section.tsx`)
// and it stays. Two transports, one table.
// ----------------------------------------------------------------------------

/**
 * The held set, as a `Set` for the lookup and nothing else.
 *
 * Built in the provider rather than accepted as one, because the value crosses
 * the server/client boundary and a `Set` does not serialise.
 */
const ViewerCapabilitiesContext = createContext<ReadonlySet<Capability> | null>(
  null
);

/**
 * Seeded once, in `src/app/(dashboard)/layout.tsx`, from the session that
 * layout already verified.
 *
 * `capabilities` arrives as an ARRAY because that is what crosses the boundary.
 */
export function ViewerCapabilitiesProvider({
  capabilities,
  children,
}: {
  capabilities: readonly Capability[];
  children: ReactNode;
}) {
  return (
    <ViewerCapabilitiesContext.Provider value={new Set(capabilities)}>
      {children}
    </ViewerCapabilitiesContext.Provider>
  );
}

/**
 * May the viewer do `capability`? Ask this immediately above the control.
 *
 * IT FAILS CLOSED WITH NO PROVIDER, and that is a deliberate choice over the
 * throw the sibling contexts in this repo use (`useHeader`, `useSidebar`).
 * Those answer layout questions, where a missing provider is a broken screen
 * and a loud error is the kindest outcome. This one answers an authority
 * question, where the two failure modes are not symmetric: a hidden control is
 * a screen with one button fewer, and a thrown error inside a shared component
 * takes down every surface that reuses it OUTSIDE the dashboard — the marketing
 * embeds of `PeopleList` and `QuickActions` render with no session at all.
 *
 * What catches the wiring mistake instead is `viewer-capabilities.test.ts`,
 * which asserts the dashboard layout mounts the provider. A control that
 * silently stops rendering everywhere is a failing test, not a support ticket.
 */
export function useCan(capability: Capability): boolean {
  return useContext(ViewerCapabilitiesContext)?.has(capability) ?? false;
}

/**
 * The wrapper form, for a control whose absence needs no other change.
 *
 * `useCan` is the primary spelling — it composes with the rest of a component's
 * conditions and reads as one boolean beside them. Reach for this only where
 * the control is a self-contained subtree and an early `return null` would take
 * its siblings with it.
 */
export function Can({
  do: capability,
  children,
}: {
  do: Capability;
  children: ReactNode;
}) {
  return useCan(capability) ? <>{children}</> : null;
}
