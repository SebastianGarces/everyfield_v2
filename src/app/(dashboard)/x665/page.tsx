// THROWAWAY — #665's bisect rig. Deleted before this branch merges.

import { redirect } from "next/navigation";

import { verifySession } from "@/lib/auth/session";

import {
  probeSlowWithRefresh,
  probeWithRefresh,
  probeWithoutRefresh,
} from "./actions";
import { DropsForm, KeepsForm } from "./probes";

export const dynamic = "force-dynamic";

export default async function Probe665Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  // Mirrors `/verify-email` exactly: force-dynamic, awaits searchParams, and
  // gates the probe behind a ternary on the token.
  const { token } = await searchParams;
  const candidate = typeof token === "string" ? token : "";

  return (
    <div className="space-y-8 p-8">
      {/* Proves the refresh actually landed: this instant changes only when
          the page re-renders on the server. */}
      <p data-testid="server-stamp">SERVER {new Date().toISOString()}</p>
      <p data-testid="who">{user.email}</p>

      <section>
        <h2>A — keeps form, no refresh</h2>
        <KeepsForm id="a" action={probeWithoutRefresh} />
      </section>
      <section>
        <h2>B — drops form, no refresh</h2>
        <DropsForm id="b" action={probeWithoutRefresh} />
      </section>
      <section>
        <h2>C — keeps form, refresh (= requestEmailChangeAction)</h2>
        <KeepsForm id="c" action={probeWithRefresh} />
      </section>
      <section>
        <h2>D — drops form, refresh (= confirmEmailChangeAction, stranded)</h2>
        <DropsForm id="d" action={probeWithRefresh} />
      </section>

      {/* The search-param dimension the first pass did not have. These render
          only under the same ternary /verify-email uses. */}
      {candidate === "" ? (
        <p data-testid="no-token">no token — E and F absent</p>
      ) : (
        <>
          <section>
            <h2>E — token-gated, drops form, refresh</h2>
            <DropsForm id="e" action={probeWithRefresh} />
          </section>
          <section>
            <h2>F — token-gated, drops form, SLOW refresh</h2>
            <DropsForm id="f" action={probeSlowWithRefresh} />
          </section>
        </>
      )}
    </div>
  );
}
