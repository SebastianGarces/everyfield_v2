import { MailQuestion } from "lucide-react";

import { InvitationAnswer } from "@/app/(dashboard)/settings/association/invitation-answer";
import type { PendingInvitationView } from "@/app/(dashboard)/settings/association/queries";
import { SettingsLink } from "@/components/settings/settings-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

// ============================================================================
// The persistent invitation reminder (#304, OV-005).
//
// NOT DISMISSIBLE — and that is the requirement, not an omission. Every other
// banner on this dashboard uses `useDismissed`; this one deliberately does not,
// because OV-005 says the reminder stands "while an association invitation is
// unanswered" and is "dismissed only by answering". Joining a sending church or
// a network decides who can see this plant, so a planter must not be able to
// make the question go away without answering it. The two buttons ARE the
// dismissal: answering either one changes the invitation's status, `refresh()`
// re-renders the dashboard, and `getPendingInvitationsForPlant` no longer
// returns it.
//
// It is therefore a SERVER component with no state of its own — the pending
// list arrives as props from the page, which read it per request. The only
// client code is `InvitationAnswer`, shared with `/settings/association` so the
// same question is answered the same way in both places.
//
// `role="status"` rather than `role="alert"`: this is standing, unanswered
// business, not something that just happened, and an assertive live region that
// re-announced on every dashboard render would be hostile.
// ============================================================================

export function AssociationReminder({
  invitations,
}: {
  invitations: PendingInvitationView[];
}) {
  if (invitations.length === 0) return null;

  return (
    // `border-primary/40`: the ONLY thing that told this banner apart from the
    // dismissible setup nudge directly beneath it was the ABSENCE of an X,
    // which is not a cue anyone reads. The heavier edge and the badge below say
    // it is standing business, and they say it without color alone.
    <Alert
      role="status"
      data-testid="association-reminder"
      className="border-primary/40 shadow-sm"
    >
      <MailQuestion />
      {/*
        `line-clamp-none`: `AlertTitle` clamps to one line, and an organization
        with a long name would have its name cut off in the sentence that names
        the decision — with nowhere else on this surface to read it.
      */}
      <AlertTitle className="line-clamp-none flex flex-wrap items-center gap-x-2 gap-y-1 text-pretty">
        <span>
          {invitations.length === 1
            ? `${invitations[0].orgName} invited your plant`
            : `${invitations.length} organizations invited your plant`}
        </span>
        <Badge variant="secondary" className="font-medium">
          Waiting on your answer
        </Badge>
      </AlertTitle>
      <AlertDescription>
        <p className="text-pretty">
          Nothing is associated until you answer. Accepting lists your plant in
          their directory with its name, stage and launch date — what else they
          hear about stays yours to decide.
        </p>

        <ul className="w-full space-y-3">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="space-y-2">
              {invitations.length > 1 && (
                <p className="text-foreground font-medium">
                  {invitation.orgName}
                </p>
              )}
              <InvitationAnswer
                invitationId={invitation.id}
                orgName={invitation.orgName}
              />
            </li>
          ))}
        </ul>

        {/* A FRAGMENT (#657). This alert only ever draws on `/dashboard`, so
            `#settings/association` opens the modal over the dashboard the reader
            is already reading — no navigation, and this card is still behind it
            when they close. `SettingsLink` is a client component so this one can
            stay a server component and still cancel the click. */}
        <SettingsLink
          section="association"
          className="cursor-pointer text-sm font-medium underline underline-offset-4"
        >
          See the details first
        </SettingsLink>
      </AlertDescription>
    </Alert>
  );
}
