// ============================================================================
// The network's sending-church roster — `/oversight/sending-churches` (OV-009).
//
// This route owns the three things a component cannot: the role guard, the
// org-scoped read, and its header breadcrumb (#261 — without a declared trail
// the shell falls back to naming a different page).
//
// NETWORK ADMINS ONLY, and the refusal is a 404 rather than a message. A
// sending-church admin IS one of the rows this page lists, so a roster of their
// peers is another org's portfolio — and "this page exists but is not for you"
// already tells them their network has a roster and how it is reached.
// `notFound()` renders `(dashboard)/not-found.tsx`, so they land inside the
// shell with their own sidebar rather than at a dead end.
//
// The nav item follows the same rule from the other side: "Sending Churches" is
// in `networkAdminNavItems` and NOT in `sendingChurchNavItems`, so nobody who
// would be refused here is ever offered the link (`navigation.test.ts` pins
// both halves).
//
// SCOPING IS THE LEAK GUARD, as on every other oversight route: the read takes
// the network id from the session user, so there is no route param, query string
// or form field on this screen that names an organization. One network cannot
// read another's roster because there is nothing to ask with.
// ============================================================================

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { SendingChurchesRoster } from "@/components/oversight/sending-churches-roster";
import { listNetworkSendingChurches } from "@/lib/oversight/sending-churches";
import { requireOversightUser } from "@/lib/oversight/session";

export const metadata: Metadata = {
  title: "Sending churches",
};

export default async function OversightSendingChurchesPage() {
  // A church-level tenancy is bounced to its own dashboard by the shared guard,
  // the same as every other oversight route — they have a home to go to. The
  // network-only refusal below is this page's own rule and stays here.
  const { user, org } = await requireOversightUser();

  // A sending-church tenancy is an oversight one with no business on this
  // surface. `listNetworkSendingChurches` refuses it a second time by resolving
  // no network, so the guard is not carried by this line alone.
  if (org.type !== "network") {
    notFound();
  }

  const sendingChurches = await listNetworkSendingChurches(user);

  return (
    <>
      {/*
        One crumb: the sidebar lists Sending Churches as a SIBLING of the
        oversight index, not a child of it, and the label matches both the nav
        item and the page's own <h1>.
      */}
      <HeaderBreadcrumbs items={[{ label: "Sending churches" }]} />
      <SendingChurchesRoster sendingChurches={sendingChurches} />
    </>
  );
}
