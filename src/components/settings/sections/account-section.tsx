"use client";

import { AvatarField } from "@/components/settings/avatar-field";
import { ChangeEmailForm } from "@/components/settings/change-email-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import type { AccountSectionView } from "@/lib/settings/section-view";

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
// THE PICTURE IS PART OF THE FIRST BLOCK, not a fourth one (CS-004, #617). It
// belongs to the same question the name and the address answer — who is this —
// and a section of its own would have been a heading saying "Profile picture"
// above a control already labelled by the button inside it. So it opens the
// identity block, above the list, and the block's heading covers all three.
//
// THE SECTION RE-STATES ITS OWN GATE BY NOT NEEDING ONE. Every signed-in
// account may edit its own credentials, including a coach holding no seat in
// any tenancy — which is exactly `self.write` (`seats: null, tenancy: "any"`),
// the verb both actions are guarded with. The registry lists this section for
// `everyAccount` for the same reason.
//
// `"use client"` SINCE #657, WITH ITS READS UNMOVED. The modal is client state
// over the current screen now, so no route renders this; `readAccount` in
// `@/lib/settings/section-data` does the same two reads this file used to do
// and hands them down. The live email-change request is still SERVER data
// arriving as a prop, never something a form copies into `useState`
// (`memory/contracts/data-patterns.md`) — `requestEmailChangeAction` calls
// `refresh()`, and the modal re-reads this view against it.
// ============================================================================

export function AccountSection({ view }: { view: AccountSectionView }) {
  return (
    <div className="space-y-8">
      <section aria-labelledby="account-identity" className="space-y-4">
        <h2
          id="account-identity"
          className="text-lg font-semibold tracking-tight"
        >
          Signed in
        </h2>

        <AvatarField
          avatarSrc={view.avatarSrc ?? undefined}
          initials={view.initials}
          name={view.name ?? view.email}
        />

        <dl className="divide-border divide-y rounded-lg border">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
            <dt className="text-muted-foreground text-sm">Name</dt>
            <dd className="min-w-0 font-medium break-words">
              {view.name ?? "Not set"}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
            <dt className="text-muted-foreground text-sm">Email</dt>
            <dd className="min-w-0 font-medium break-all">{view.email}</dd>
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
          currentEmail={view.email}
          pending={view.pendingEmail ? { newEmail: view.pendingEmail } : null}
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
