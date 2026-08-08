"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Users } from "lucide-react";

import { initializeTeamsWithRolesAction } from "@/app/(dashboard)/teams/actions";
import { Button } from "@/components/ui/button";
import {
  TEAM_TEMPLATES,
  getTotalRoleTemplateCount,
} from "@/lib/ministry-teams/role-templates";

/**
 * F12 / OB-015 — the onboarding finish screen.
 *
 * ONE OFFER, AND ONLY FOR PLANTERS WHO SAID THEY ARE THERE. A planter who
 * declared phase 2 or later is already forming teams in real life, so the
 * structure EveryField would otherwise ask them to build by hand is offered in
 * one press. Whether this screen appears at all is the flow's decision
 * (`shouldOfferTeamTemplates`, `./team-template-offer`); by the time this
 * component renders, the answer is yes.
 *
 * DECLINING WRITES NOTHING. It is the same move as finishing without the offer
 * — `onDone()` and nothing else — which is why there is no "maybe later" state
 * to persist and nothing to undo. The teams page carries the same
 * initialization forever, so "not now" costs the planter one click later.
 *
 * THIS SCREEN OWNS NO TEAM MACHINERY. It calls one action, and that action is
 * itself a caller of the two `/teams` has always used. No roster assignment and
 * no role editing happen here on purpose (OB-015): staffing is a conversation
 * with a list of people the planter may not even have imported yet, and it has
 * a home. The card links there rather than growing a second one.
 *
 * NOTHING SERVER-SIDE ROUND-TRIPS THROUGH `useState` here
 * (`memory/contracts/data-patterns.md`): the two pieces of state are the
 * in-flight press and the sentence to show if it failed. What was created is
 * read on the surface that owns it, after the redirect.
 */

/**
 * Shown when the accept request itself failed — as opposed to the action
 * returning a reason, which is rendered verbatim. Says what is safe and what to
 * do, because both are true: nothing else in the flow is affected, the offer
 * can be pressed again, and the dashboard is one click away regardless.
 */
const OFFER_FAILED_MESSAGE =
  "We could not set up the teams just now. Nothing else you have saved is affected — try again, or head to your dashboard and set them up from the Teams page.";

export function FinishScreen({
  onDone,
  busy,
}: {
  /** Leaves onboarding: completes it and lands on the dashboard. */
  onDone: () => void;
  /** The flow's own finish is in flight. */
  busy: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Which control was pressed, so the progress word lands on the button the
  // planter actually pressed. Both are disabled either way; without this, the
  // flow's finish (`busy`) would report itself on the control they declined.
  const [pressed, setPressed] = useState<"accept" | "decline" | null>(null);

  const disabled = pending || busy;
  const teamCount = TEAM_TEMPLATES.length;
  const roleCount = getTotalRoleTemplateCount();

  function decline() {
    setPressed("decline");
    onDone();
  }

  function accept() {
    setError(null);
    setPressed("accept");

    startTransition(async () => {
      try {
        const result = await initializeTeamsWithRolesAction();

        if (!result.success) {
          setError(result.error);
          setPressed(null);
          return;
        }

        onDone();
      } catch {
        // The action rejected — the request never reached the server, or the
        // server threw something it did not turn into an outcome. Uncaught,
        // that rejection escapes an async transition callback and leaves the
        // button stuck pending with nothing rendered. Caught, it is a sentence
        // and two working buttons.
        setError(OFFER_FAILED_MESSAGE);
        setPressed(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
        >
          {error}
        </p>
      )}

      <p className="text-sm">
        Your church plant is saved and your dashboard is ready. One thing before
        you go, because of where you said you are.
      </p>

      <div className="border-border space-y-4 rounded-md border p-4">
        <div className="space-y-2">
          <Users className="text-primary size-5" aria-hidden="true" />
          <h3 className="text-sm font-medium">
            Start with the standard ministry teams
          </h3>
          <p className="text-muted-foreground text-sm">
            You are forming a launch team already, so we can create the{" "}
            {teamCount} ministry teams a plant this far along usually needs —
            worship, children&rsquo;s ministry, facilities, small groups and the
            rest — each with its role descriptions ready to fill, {roleCount}{" "}
            roles in all.
          </p>
          <p className="text-muted-foreground text-sm">
            The teams start empty. Naming leaders, filling roles and adding
            teams of your own all happen on{" "}
            <Link href="/teams" className="underline underline-offset-4">
              Teams
            </Link>
            , whenever you are ready — and so does this same setup if you would
            rather do it later.
          </p>
        </div>

        <Button
          type="button"
          className="w-full cursor-pointer sm:w-auto"
          onClick={accept}
          disabled={disabled}
        >
          {pending
            ? "Setting up teams…"
            : pressed === "accept"
              ? "Finishing…"
              : "Set up the teams"}
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          className="cursor-pointer"
          onClick={decline}
          disabled={disabled}
        >
          {pressed === "decline" && busy
            ? "Finishing…"
            : "Not now — go to my dashboard"}
        </Button>
      </div>
    </div>
  );
}
