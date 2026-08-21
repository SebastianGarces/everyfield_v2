"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { loginPathFor } from "@/lib/auth/safe-redirect";
import { coachInvitationPath } from "@/lib/invitations/register-path";
import {
  invitedAsWithArticle,
  type InvitedAs,
} from "@/lib/invitations/seat-copy";
import type { AccountType } from "@/lib/validations/auth";
import Link from "next/link";
import { useActionState, useState } from "react";
import { register, type RegisterState } from "./actions";
import type { RegistrationInvitation } from "./beta-gate";

const initialState: RegisterState = {};

const ACCOUNT_TYPE_CONFIG: Record<
  AccountType,
  {
    label: string;
    description: string;
    orgLabel: string;
    orgPlaceholder: string;
  }
> = {
  planter: {
    label: "Church Planter",
    description: "I'm planting a new church",
    orgLabel: "Church plant name",
    orgPlaceholder: "e.g., Grace Community Church",
  },
  sending_church: {
    label: "Sending Church",
    description: "I'm a sending church overseeing planters",
    orgLabel: "Sending church name",
    orgPlaceholder: "e.g., First Baptist Church",
  },
  network: {
    label: "Church Planting Network",
    description: "I'm a network overseeing sending churches and planters",
    orgLabel: "Network name",
    orgPlaceholder: "e.g., Send Network",
  },
};

/**
 * Registration form.
 *
 * `betaGateEnabled` is a boolean derived server-side from `BETA_INVITE_CODE`.
 * The actual code value is NEVER passed to the client — we only learn whether
 * to render the invite-code input. Enforcement happens server-side in the
 * `register` action regardless of this flag.
 *
 * `invitation` is the missing half of the invite flow (#23). `register` has
 * always read an `invitationId` from the form; nothing ever rendered one, so
 * the token could not reach it and invite-at-registration was dead. The hidden
 * field below is that wire. Everything else it drives is presentation: the
 * account type is preselected, the church-plant name becomes required (an
 * invitation exists to associate a plant, so the plant has to exist), and the
 * beta-code input steps aside because the invitation IS the invite.
 *
 * One thing it drives is NOT presentation, though it looks like it: the email
 * field is pre-filled and read-only (RULED 2026-08-04). The rule itself lives in
 * `register` (through `invitationActedOnAtRegistration`) and in
 * `hasValidInvitationBypass`, which both refuse to act on an invitation for a
 * registering address that is not the invited one.
 *
 * THIS FIELD IS NOW THE ONLY WARNING A HONEST USER GETS, which is why it is
 * pre-filled rather than merely validated. Ruling C (#304 round 11, 2026-08-12)
 * deleted the server's mismatch message: `/register` is an anonymous POST, and a
 * per-row message there told a stranger holding any invitation id whether that
 * id was live and which address it named. A wrong address now falls through to
 * the ordinary sign-up in silence, so the form's job is to make the wrong
 * address hard to submit in the first place.
 */
export type SeatInvitationForForm = {
  /** The raw `?invitation=` value — the wire the action re-resolves from. */
  token: string;
  inviteeEmail: string;
  churchName: string;
  /**
   * The invitation's own vocabulary, never a second spelling of it — the union,
   * so a coach invitation redeemed at sign-up (#496) cannot be described with a
   * seat's words.
   */
  invitedAs: InvitedAs;
};

export function RegisterForm({
  betaGateEnabled,
  invitation = null,
  seatInvitation = null,
}: {
  betaGateEnabled: boolean;
  invitation?: RegistrationInvitation | null;
  /**
   * A SEAT invitation (#495) — the other thing `?invitation=` can carry. It
   * decides more of this form than an org invitation does, because there is
   * nothing left to ask: the plant exists, the seat is named, and the address is
   * the invitation's. So the account-type radio, the organization-name field
   * and the beta-code input are all absent, and what remains is the person's
   * name and a password.
   */
  seatInvitation?: SeatInvitationForForm | null;
}) {
  const [state, formAction, pending] = useActionState(register, initialState);
  // EVERY INVITATION THAT REACHES THIS FORM IS REDEEMABLE (#304 round 10,
  // ruled 2026-08-11). There used to be a `redeeming = invitation?.redeemable`
  // branch here, and the whole form varied on it — which told a visitor
  // holding any invitation id whether its address already had an account.
  // `describeInvitationForRegistration` now answers `null` for a targeted row,
  // so a non-null `invitation` is an OPEN one by construction and there is
  // nothing left to branch on.
  //
  // An invitation DECIDES the account type — it was issued to a church plant or
  // to a sending church, and picking the other one would create an organization
  // the invitation cannot associate. So the choice is not offered.
  const [accountType, setAccountType] = useState<AccountType>(
    invitation?.accountType ?? "planter"
  );

  // ONE FLAG for "an invitation decided this form", so the four places that
  // used to test `invitation` cannot start disagreeing about the second kind
  // (#495). NOT a redeemability branch — that word and that idea were deleted
  // by #304 round 10 and `invitations-ui.test.ts` §9b fails on their return.
  // This is the presence of a token, which is a fact this form was rendered
  // with rather than anything the server discovered about an address.
  const invited = Boolean(invitation) || Boolean(seatInvitation);
  const invitationToken = seatInvitation?.token ?? invitation?.id ?? null;

  // Controlled so a rejected submit (e.g. invalid invite code) keeps everything
  // the user already typed instead of clearing the form.
  const [name, setName] = useState("");
  // AN INVITATION DECIDES THE ADDRESS — RULED 2026-08-04. The invitation was
  // issued to one person; a link holder who typed a different address used to
  // walk off with somebody else's association. So the field is pre-filled and
  // read-only (read-only, not `disabled` — a disabled input is not submitted),
  // and the action re-checks it anyway, since a POST never saw this form.
  const emailLockedToInvitation = invited;
  const [email, setEmail] = useState(
    seatInvitation?.inviteeEmail ?? invitation?.inviteeEmail ?? ""
  );
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  const config = ACCOUNT_TYPE_CONFIG[accountType];
  // An invited planter names their plant here; a cold planter signup still
  // creates no church and is not asked for one.
  const needsPlantName =
    invitation?.accountType === "planter" && accountType === "planter";

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Create an account</CardTitle>
        <CardDescription>
          Get started with EveryField by choosing your role
        </CardDescription>
      </CardHeader>
      <form action={formAction}>
        <input type="hidden" name="accountType" value={accountType} />
        {/*
          THE WIRE. `register/actions.ts` reads `invitationId`; without this
          field it never arrived, so the beta-gate bypass never fired and an
          invited planter finished signup unassociated (#23).
        */}
        {invitationToken !== null && (
          <input type="hidden" name="invitationId" value={invitationToken} />
        )}
        <CardContent className="space-y-6">
          {seatInvitation && (
            <div
              role="status"
              className="border-primary/30 bg-primary/5 rounded-md border p-3 text-sm"
            >
              <p className="font-medium">
                {seatInvitation.churchName} invited you to EveryField
              </p>
              <p className="text-muted-foreground mt-1">
                Finish signing up and you will join them as{" "}
                {invitedAsWithArticle(seatInvitation.invitedAs)}.
              </p>
            </div>
          )}
          {invitation && (
            <div
              role="status"
              className="border-primary/30 bg-primary/5 rounded-md border p-3 text-sm"
            >
              <p className="font-medium">
                {invitation.invitingOrgName} invited you to EveryField
              </p>
              <p className="text-muted-foreground mt-1">
                {invitation.accountType === "planter"
                  ? "Name your church plant below — it will be associated with them as soon as you finish."
                  : "Your sending church will be associated with them as soon as you finish."}
              </p>
            </div>
          )}
          {state.error && (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              {state.error}
            </div>
          )}

          {/* Account Type Selection — not offered while an invitation is being
              answered, since it already decided the answer (see above). */}
          {!invited && (
            <div className="space-y-3">
              <Label>I am a...</Label>
              <RadioGroup
                value={accountType}
                onValueChange={(v) => setAccountType(v as AccountType)}
                className="gap-3"
              >
                {(
                  Object.entries(ACCOUNT_TYPE_CONFIG) as [
                    AccountType,
                    (typeof ACCOUNT_TYPE_CONFIG)[AccountType],
                  ][]
                ).map(([type, cfg]) => (
                  <label
                    key={type}
                    className="border-input has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
                  >
                    <RadioGroupItem
                      value={type}
                      className="mt-0.5 cursor-pointer"
                    />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{cfg.label}</div>
                      <div className="text-muted-foreground text-xs">
                        {cfg.description}
                      </div>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          {/* Organization Name — always for sending church / network, and for
              an INVITED planter, whose plant is created at signup so the
              invitation has something to associate. */}
          {!seatInvitation && (accountType !== "planter" || needsPlantName) && (
            <div className="space-y-2">
              <Label htmlFor="organizationName">{config.orgLabel}</Label>
              <Input
                id="organizationName"
                name="organizationName"
                type="text"
                placeholder={config.orgPlaceholder}
                required
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                aria-invalid={!!state.fieldErrors?.organizationName}
              />
              {state.fieldErrors?.organizationName && (
                <p className="text-destructive text-sm">
                  {state.fieldErrors.organizationName}
                </p>
              )}
            </div>
          )}

          {/* Personal Details */}
          <div className="space-y-2">
            <Label htmlFor="name">Your full name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              placeholder="John Smith"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!state.fieldErrors?.name}
            />
            {state.fieldErrors?.name && (
              <p className="text-destructive text-sm">
                {state.fieldErrors.name}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              readOnly={emailLockedToInvitation}
              className={emailLockedToInvitation ? "bg-muted" : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!state.fieldErrors?.email}
              aria-describedby={
                emailLockedToInvitation ? "email-invitation-note" : undefined
              }
            />
            {emailLockedToInvitation && (
              <p
                id="email-invitation-note"
                className="text-muted-foreground text-xs"
              >
                Your invitation was sent to this address, so the account is
                created for it. If it is wrong, ask whoever invited you to send
                a new invitation.
              </p>
            )}
            {state.fieldErrors?.email && (
              <p className="text-destructive text-sm">
                {state.fieldErrors.email}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!state.fieldErrors?.password}
            />
            {state.fieldErrors?.password && (
              <p className="text-destructive text-sm">
                {state.fieldErrors.password}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Must be at least 8 characters
            </p>
          </div>

          {/* Private-beta invite code (only rendered when gating is on, and
              never for an invited user — the invitation IS the invite, and the
              server grants the same bypass). */}
          {betaGateEnabled && !invited && (
            <div className="space-y-2 pb-8">
              <Label htmlFor="inviteCode">Invite code</Label>
              <Input
                id="inviteCode"
                name="inviteCode"
                type="text"
                placeholder="Enter your beta invite code"
                autoComplete="off"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                EveryField is in private beta. Ask your sending church or
                network for an invite code.
              </p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-4">
          <Button
            type="submit"
            className="w-full cursor-pointer"
            disabled={pending}
          >
            {pending ? "Creating account..." : "Create account"}
          </Button>
          <p className="text-muted-foreground text-center text-sm">
            Already have an account?{" "}
            {/*
              A COACH INVITEE KEEPS THEIR TOKEN THROUGH THE ROUND TRIP (#496).

              A coach invitation may be answered by an account that already
              exists — that is the whole of AS-009 — and this link is the exit
              such a reader takes when the sign-up form refuses their address as
              a duplicate. A bare `/login` drops the token and lands them on
              `/dashboard`, so the only way back is the original email.

              This leaks nothing: the branch is on the invitation KIND, which the
              reader already holds in their own URL, never on whether the address
              has an account.
            */}
            <Link
              href={
                seatInvitation?.invitedAs.kind === "coach"
                  ? loginPathFor(coachInvitationPath(seatInvitation.token))
                  : "/login"
              }
              className="text-primary hover:underline"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
