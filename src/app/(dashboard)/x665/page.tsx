// THROWAWAY — #665's bisect rig. Deleted before this branch merges.

import { redirect } from "next/navigation";

import { verifySession } from "@/lib/auth/session";

import { probeWithRefresh, probeWithoutRefresh } from "./actions";
import { DropsForm, KeepsForm } from "./probes";

export const dynamic = "force-dynamic";

export default async function Probe665Page() {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  return (
    <div className="space-y-8 p-8">
      {/* Proves the refresh actually landed: this instant changes only when
          the page re-renders on the server. */}
      <p data-testid="server-stamp">SERVER {new Date().toISOString()}</p>

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
    </div>
  );
}
