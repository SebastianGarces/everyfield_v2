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

import { setNotificationEmailStateAction } from "./actions";

// ============================================================================
// Screen 3 — the unsubscribe confirmation (FRD → Screens → Unsubscribe
// Confirmation).
//
// It is reached with NO SESSION, from a link in an inbox, so the governing
// question is not what to show but what to withhold. The FRD's list is exact:
// which category was disabled, for which address, an undo, a link to full
// preferences, and "never exposes any other information about the account".
//
// So this page renders four facts and no fifth. No name, no church, no role, no
// other category's state, no notification content, no "last signed in" — none
// of which it even loads (`describeUnsubscribeSubject` selects one column from
// `users`). A refused token renders a page with no account facts at all and the
// SAME copy whether the token was forged, edited or merely old: telling a
// stranger which one would confirm whether a given link ever belonged to a real
// account here.
//
// It does not mutate. The opt-out already happened in the route that redirected
// here (`/api/notifications/unsubscribe`), and a page that re-applied it on
// render would undo the undo on the first refresh.
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
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = await describeUnsubscribeSubject(token ?? "");

  return (
    <main className="bg-muted/30 flex min-h-svh items-center justify-center p-6">
      {result.status === "ok" ? (
        <SubjectCard token={token ?? ""} subject={result.subject} />
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
}: {
  token: string;
  subject: UnsubscribeSubjectView;
}) {
  const label = subject.categoryLabel.toLowerCase();

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          {subject.enabled ? "You're subscribed again" : "You're unsubscribed"}
        </CardTitle>
        <CardDescription>
          {subject.enabled ? (
            <>
              We will keep sending <strong>{label}</strong> emails to{" "}
              <strong>{subject.email}</strong>.
            </>
          ) : (
            <>
              We will no longer send <strong>{label}</strong> emails to{" "}
              <strong>{subject.email}</strong>. Other notifications are
              unchanged.
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <form action={setNotificationEmailStateAction}>
          <input type="hidden" name="token" value={token} />
          <input
            type="hidden"
            name="enabled"
            value={subject.enabled ? "false" : "true"}
          />
          <Button
            type="submit"
            variant={subject.enabled ? "outline" : "default"}
            className="w-full cursor-pointer"
          >
            {subject.enabled
              ? `Unsubscribe from ${label} emails`
              : `Undo — keep sending ${label} emails`}
          </Button>
        </form>

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
      </CardContent>
    </Card>
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
