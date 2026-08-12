import { LogIn, LogOut } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { formatDate } from "@/lib/datetime";
import type { AssociationHistoryEntry } from "@/lib/invitations/history";

// ============================================================================
// AssociationHistory — the audit trail on `/oversight/plants/[id]` (OV-011).
//
// Presentational and pure: the page owns the scoping. Every entry it is handed
// already belongs to the CALLER'S OWN org (`getAssociationHistoryForOrg` puts
// `org_type` and `org_id` in the WHERE clause), so there is no org name in this
// file to get wrong and nothing here that could render a third org's history.
//
// WHY THE HISTORY IS SHOWN AT ALL, and why it is not just a "joined on" date.
// `churches.sending_church_id` is current state and nothing more, now that both
// sides can sever: once it is null, "were they ever ours, who put them there, who
// took them out, and when" is unanswerable from that row. A directory that can
// only ever show today makes a plant that joined, left and re-joined
// indistinguishable from one that joined last week — and the second reading is
// the one an admin will act on.
//
// TWO EVENTS, NAMED AS EVENTS. "Associated" and "disassociated" are the column's
// vocabulary, not a reader's; a person scanning this wants a verb and a date. The
// verb is deliberately neutral for the departure — the row records WHO acted, and
// that is the only thing that distinguishes a plant that left from a plant that
// was removed. Labelling it "left" would misreport half of them.
//
// DATES GO THROUGH `formatDate`, which pins the zone (`memory/invariants.md` →
// Date & Time Rendering). A bare `toLocaleDateString` here follows the runtime's
// zone and makes SSR and hydration disagree.
// ============================================================================

export function AssociationHistory({
  entries,
  plantName,
}: {
  entries: AssociationHistoryEntry[];
  plantName: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        {/*
          A REAL HEADING, not `CardTitle` (design pass, #304 "UI ruling round
          3"). `CardTitle` renders a `div`, so the page used to carry a
          `sr-only` h2 saying "Association history" directly above a visible
          title saying it again — a screen reader heard the section named
          twice. One element now does both jobs, and `plant-detail.tsx` points
          its `<section aria-labelledby>` at this id.
        */}
        <h2
          id="plant-association-history"
          className="text-base leading-none font-semibold tracking-tight"
        >
          Association history
        </h2>
        <CardDescription className="text-pretty">
          Every time {plantName} joined or left your organization, and who
          recorded it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          /*
            Not a bare blank, and not "no history" either. An association that
            predates the audit table — or one that came from seeding — is a fact
            worth stating, because the alternative reading of an empty list is
            that the plant is not associated at all, which the rest of this page
            contradicts.
          */
          /*
            Centered, not a dashed rectangle inside the card. A dashed box
            nested in a bordered surface reads as a drop target and adds a
            second edge one step in from the card's own.
          */
          <p className="text-muted-foreground mx-auto max-w-prose py-4 text-center text-sm text-pretty">
            Nothing recorded yet. This association was made before EveryField
            started keeping a history of them.
          </p>
        ) : (
          <ol className="divide-border -my-3 divide-y">
            {entries.map((entry) => (
              <li key={entry.id} className="flex gap-3 py-3">
                <span className="text-muted-foreground mt-0.5 shrink-0">
                  {entry.event === "associated" ? (
                    <LogIn className="size-4" aria-hidden="true" />
                  ) : (
                    <LogOut className="size-4" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-foreground text-sm font-medium">
                    {entry.event === "associated"
                      ? "Association began"
                      : "Association ended"}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {formatDate(entry.occurredAt, "long")}
                    {" · recorded by "}
                    {/*
                      `actor_user_id` is NOT NULL, so a missing name is an
                      account with none set — never a missing actor. Saying so
                      beats an empty space after "recorded by".
                    */}
                    {entry.actorName ?? "an account with no name set"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
