import { ChangeEmailForm } from "@/components/settings/change-email-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { liveEmailChangeRequest } from "@/lib/auth/email-change";
import { verifySession } from "@/lib/auth/session";

// ============================================================================
// Account — who you are signed in as, and the two credentials you can change
// (CS-001 shell, CS-002 / CS-003, #616).
//
// THREE BLOCKS, IN THE ORDER SOMEBODY READS THEM: what is true now, then the
// address, then the password. The identity list stays even though the forms
// below repeat the address — it is the answer to "which account is this?", which
// is the question that brought most readers here, and a form is a worse way to
// read a value than a value is.
//
// THE SECTION RE-STATES ITS OWN GATE BY NOT NEEDING ONE. Every signed-in
// account may edit its own credentials, including a coach holding no seat in
// any tenancy — which is exactly `self.write` (`seats: null, tenancy: "any"`),
// the verb both actions are guarded with. The registry lists this section for
// `everyAccount` for the same reason.
//
// THE LIVE REQUEST IS READ HERE, on the server, and passed down. The form holds
// no server data in `useState` (memory/contracts/data-patterns.md); the action
// calls `refresh()`, and this read is what "check your inbox" reconciles
// against.
//
// CS-004's profile picture is still its own issue. Nothing here promises it —
// the control arrives by appearing.
// ============================================================================

export async function AccountSection() {
  const { user } = await verifySession();
  const pending = await liveEmailChangeRequest(user.id);

  return (
    <div className="space-y-8">
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

      <section aria-labelledby="account-email" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="account-email"
            className="text-lg font-semibold tracking-tight"
          >
            Email address
          </h2>
          <p className="text-muted-foreground text-sm text-pretty">
            We send a confirmation link to the new address. It becomes your
            sign-in address once you open that link — until then nothing
            changes, and we tell your old address when it does.
          </p>
        </div>

        <ChangeEmailForm
          currentEmail={user.email}
          pending={pending ? { newEmail: pending.newEmail } : null}
        />
      </section>

      <section aria-labelledby="account-password" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="account-password"
            className="text-lg font-semibold tracking-tight"
          >
            Password
          </h2>
          <p className="text-muted-foreground text-sm text-pretty">
            Changing your password signs you out everywhere except here.
          </p>
        </div>

        <ChangePasswordForm />
      </section>
    </div>
  );
}
