import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NOTIFICATION_PREFERENCES_PATH } from "@/lib/notifications/channels/email";
import {
  describeUnsubscribeSubject,
  type UnsubscribeSubjectView,
} from "@/lib/notifications/channels/unsubscribe";

import { confirmUnsubscribeAction, undoUnsubscribeAction } from "./actions";

// ============================================================================
// Screen 3 — the unsubscribe confirmation (FRD → Screens → Unsubscribe
// Confirmation), and since 2026-08-01 the place the opt-out actually happens.
//
// It is reached with NO SESSION, from a link in an inbox, so the governing
// question is not what to show but what to withhold. The FRD's list is exact:
// which category is affected, for which address, an undo, a link to full
// preferences, and "never exposes any other information about the account".
//
// So this page renders four facts and no fifth. No name, no church, no role, no
// other category's state, no notification content, no "last signed in" — none
// of which it even loads (`describeUnsubscribeSubject` reads one column from
// `users` plus that user's own preference rows). A refused token renders a page
// with no account facts at all and the SAME copy whether the token was forged,
// edited or merely old: telling a stranger which one would confirm whether a
// given link ever belonged to a real account here.
//
// RENDERING CHANGES NOTHING. The emailed link's GET lands here and this page
// only reads — mail scanners fetch every URL in a delivered message, and a page
// that mutated on render would opt those readers out without their ever seeing
// it. The write is on the button below, which is a POST no scanner will make.
//
// Three states, because "on" means two different things:
//   1. on, arrived from an email  → ask ("Unsubscribe from tasks emails?")
//   2. off                        → confirm, and offer the short-lived undo
//   3. on, just pressed undo      → confirm the undo, and offer the opt-out again
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notification emails",
  // The URL carries a capability token. Keep it out of indexes entirely.
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; resubscribed?: string }>;
}) {
  const { token, resubscribed } = await searchParams;
  const result = await describeUnsubscribeSubject(token ?? "");

  return (
    <main className="bg-muted/30 flex min-h-svh items-center justify-center p-6">
      {result.status === "ok" ? (
        <SubjectCard
          token={token ?? ""}
          subject={result.subject}
          justResubscribed={resubscribed === "1"}
        />
      ) : (
        <RefusedCard />
      )}
    </main>
  );
}

/**
 * The one card that can name an account fact — and it names exactly two: the
 * category and the address, both of which the reader already had in the email
 * that brought them here.
 */
function SubjectCard({
  token,
  subject,
  justResubscribed,
}: {
  token: string;
  subject: UnsubscribeSubjectView;
  justResubscribed: boolean;
}) {
  const label = subject.categoryLabel.toLowerCase();

  if (!subject.enabled) {
    return <UnsubscribedCard token={token} subject={subject} label={label} />;
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          {justResubscribed
            ? "You're subscribed again"
            : `Unsubscribe from ${label} emails?`}
        </CardTitle>
        <CardDescription>
          {justResubscribed ? (
            <>
              We will keep sending <strong>{label}</strong> emails to{" "}
              <strong>{subject.email}</strong>.
            </>
          ) : (
            <>
              We currently send <strong>{label}</strong> emails to{" "}
              <strong>{subject.email}</strong>. Nothing has changed yet — other
              notifications stay as they are either way.
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* The mutation. A POST, so following the link never performs it. */}
        <form action={confirmUnsubscribeAction}>
          <input type="hidden" name="token" value={token} />
          <Button
            type="submit"
            variant={justResubscribed ? "outline" : "default"}
            className="w-full cursor-pointer"
          >
            Unsubscribe from {label} emails
          </Button>
        </form>

        <PreferencesNote />
      </CardContent>
    </Card>
  );
}

/** After the opt-out: what happened, and the one-hour undo. */
function UnsubscribedCard({
  token,
  subject,
  label,
}: {
  token: string;
  subject: UnsubscribeSubjectView;
  label: string;
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>You're unsubscribed</CardTitle>
        <CardDescription>
          We will no longer send <strong>{label}</strong> emails to{" "}
          <strong>{subject.email}</strong>. Other notifications are unchanged.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {subject.undoToken ? (
          <form action={undoUnsubscribeAction} className="space-y-2">
            <input type="hidden" name="token" value={token} />
            {/* Minted for this render, valid for an hour, and never mailed —
                the emailed link cannot do this. */}
            <input type="hidden" name="undoToken" value={subject.undoToken} />
            <Button type="submit" className="w-full cursor-pointer">
              Undo — keep sending {label} emails
            </Button>
            <p className="text-muted-foreground text-xs">
              This undo works for the next hour. After that, sign in to turn
              these emails back on.
            </p>
          </form>
        ) : null}

        <PreferencesNote />
      </CardContent>
    </Card>
  );
}

function PreferencesNote() {
  return (
    <p className="text-muted-foreground text-sm">
      <Link
        href={NOTIFICATION_PREFERENCES_PATH}
        // The URL that got here carries a capability token; do not hand it
        // to the next page as a referrer.
        referrerPolicy="no-referrer"
        className="cursor-pointer underline underline-offset-4"
      >
        Manage all notification preferences
      </Link>{" "}
      — sign in to choose what arrives by email and in the app.
    </p>
  );
}

/**
 * Every refusal renders this. It states no address, no category, and no reason
 * — a page that distinguished "expired" from "never valid" would answer a
 * question a stranger has no business asking.
 */
function RefusedCard() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>This link is no longer valid</CardTitle>
        <CardDescription>
          Unsubscribe links stop working after a while, and nothing has been
          changed. You can still choose what arrives by email from your
          notification preferences.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild className="w-full cursor-pointer">
          <Link
            href={NOTIFICATION_PREFERENCES_PATH}
            referrerPolicy="no-referrer"
          >
            Sign in to manage preferences
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
