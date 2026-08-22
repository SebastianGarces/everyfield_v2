import { verifySession } from "@/lib/auth/session";

// ============================================================================
// Account — the SHELL only (CS-001, #615).
//
// The three controls this section is for — change email (CS-002), change
// password (CS-003), profile picture (CS-004) — are each their own issue, and
// each rides auth machinery (verification, the shared rate-limit guard, object
// storage) that a settings-chrome change has no business standing up. What
// ships here is what the section can answer honestly today: the identity the
// reader is signed in as, which is the thing the other three will edit.
//
// No "coming soon" line: a promise with no date is not information, and the
// controls arrive by appearing.
// ============================================================================

export async function AccountSection() {
  const { user } = await verifySession();

  return (
    <section aria-labelledby="account-identity" className="space-y-4">
      <h2
        id="account-identity"
        className="text-lg font-semibold tracking-tight"
      >
        Signed in
      </h2>

      <dl className="divide-border divide-y rounded-lg border">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
          <dt className="text-muted-foreground text-sm">Name</dt>
          <dd className="min-w-0 font-medium break-words">
            {user.name ?? "Not set"}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
          <dt className="text-muted-foreground text-sm">Email</dt>
          <dd className="min-w-0 font-medium break-all">{user.email}</dd>
        </div>
      </dl>
    </section>
  );
}
