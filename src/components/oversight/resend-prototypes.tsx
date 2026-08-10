"use client";

// ============================================================================
// PROTOTYPE BENCH — throwaway. Delete with the switcher when #392's spec
// question is ruled (.claude/skills/prototype/SKILL.md → "Applying the ruling").
//
// The question: inside the 60-second dedupe window a second deliberate Resend
// reports "Email sent" for a message Resend drops as a duplicate. Four
// directions, all mounted, one visible at a time via `data-resend-proto` on
// <html>.
//
// NOTHING IS SENT. The transport below is a stub that reproduces the real key
// arithmetic from `@/lib/invitations/email` — `org-invitation-<id>-resend-
// <Math.floor(now / 60_000)>` — and drops a repeat of a key it has already
// seen, exactly as the provider does. The bench prints BOTH sides: what the
// screen claimed, and what the provider actually did with it. The whole
// decision is the gap between those two columns.
// ============================================================================

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Same constant as production (`RESEND_DEDUPE_WINDOW_MS`). */
const WINDOW_MS = 60_000;
const INVITATION_ID = "proto-inv-7f3c";
const INVITEE = "pastor.sam@gracechapel.org";
/** The stub's round trip, so "Sending…" is visible rather than theoretical. */
const LATENCY_MS = 600;

type Variant = "a" | "b" | "c" | "d";

type LogEntry = {
  at: number;
  variant: Variant;
  key: string;
  /** What the provider did — the truth. */
  delivered: boolean;
  /** What the screen told the admin — the claim. */
  claim: string;
};

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function minuteLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The window bucket a press falls in — the real arithmetic, verbatim. */
function windowOf(at: number): number {
  return Math.floor(at / WINDOW_MS);
}

/** Milliseconds until the current bucket ends. */
function msLeftInWindow(at: number): number {
  return (windowOf(at) + 1) * WINDOW_MS - at;
}

type Send = {
  at: number;
  key: string;
  delivered: boolean;
  /** True when this press landed in the same bucket as an earlier delivery. */
  repeat: boolean;
};

/**
 * The stubbed provider. `windowed: false` gives every press its own key (option
 * C), so nothing is ever deduped provider-side.
 */
function useStubbedResend(
  variant: Variant,
  windowed: boolean,
  onLog: (entry: LogEntry) => void
) {
  // Keys this fake provider has already accepted. Per variant, so switching
  // options does not poison the next one.
  const seen = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [last, setLast] = useState<Send | null>(null);

  const press = (claimFor: (send: Send) => string) => {
    setPending(true);
    window.setTimeout(() => {
      const at = Date.now();
      const key = windowed
        ? `org-invitation-${INVITATION_ID}-resend-${windowOf(at)}`
        : `org-invitation-${INVITATION_ID}-resend-${at}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
      const repeat = seen.current.has(key);
      const delivered = !repeat;
      seen.current.add(key);
      const send: Send = { at, key, delivered, repeat };
      setLast(send);
      setPending(false);
      onLog({ at, variant, key, delivered, claim: claimFor(send) });
    }, LATENCY_MS);
  };

  const reset = () => {
    seen.current = new Set();
    setLast(null);
  };

  return { pending, last, press, reset };
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium">{INVITEE}</p>
        <p className="text-muted-foreground text-xs">
          Church plant · Sent Aug 10 · Expires Aug 24
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Badge>Pending</Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled
        >
          Copy link
        </Button>
        {children}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive cursor-pointer"
          disabled
        >
          Revoke
        </Button>
      </div>
    </div>
  );
}

/**
 * A · As built. Every completed press says "Email sent", including the one the
 * provider dropped.
 */
function VariantA({ onLog }: { onLog: (entry: LogEntry) => void }) {
  const { pending, last, press } = useStubbedResend("a", true, onLog);
  const claim = "Email sent";

  return (
    <Row>
      <div className="flex items-center gap-2">
        {last && !pending && (
          <span role="status" className="text-muted-foreground text-xs">
            {claim}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={pending}
          onClick={() => press(() => claim)}
        >
          {pending ? "Sending…" : "Resend email"}
        </Button>
      </div>
    </Row>
  );
}

/**
 * B · Name the minute. Copy only — no new state on the server, no gating of the
 * button. A repeat inside the same bucket says so instead of claiming a second
 * delivery.
 */
function VariantB({ onLog }: { onLog: (entry: LogEntry) => void }) {
  const { pending, last, press } = useStubbedResend("b", true, onLog);
  const claimFor = (send: Send) =>
    send.repeat
      ? `Already sent at ${minuteLabel(send.at)} — same email, nothing new went out`
      : `Email sent at ${minuteLabel(send.at)}`;

  return (
    <Row>
      <div className="flex items-center gap-2">
        {last && !pending && (
          <span
            role="status"
            className={
              last.repeat
                ? "text-xs text-amber-600 dark:text-amber-500"
                : "text-muted-foreground text-xs"
            }
          >
            {claimFor(last)}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={pending}
          onClick={() => press(claimFor)}
        >
          {pending ? "Sending…" : "Resend email"}
        </Button>
      </div>
    </Row>
  );
}

/**
 * C · No window. The resend key carries a per-press nonce, so the provider
 * never dedupes and "Email sent" is always true. Double-click protection is the
 * button's own `disabled={pending}` — which is per browser tab, so two admins
 * on this page each get a delivery.
 */
function VariantC({ onLog }: { onLog: (entry: LogEntry) => void }) {
  const { pending, last, press } = useStubbedResend("c", false, onLog);
  const claim = "Email sent";

  return (
    <Row>
      <div className="flex items-center gap-2">
        {last && !pending && (
          <span role="status" className="text-muted-foreground text-xs">
            {claim}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={pending}
          onClick={() => press(() => claim)}
        >
          {pending ? "Sending…" : "Resend email"}
        </Button>
      </div>
    </Row>
  );
}

/**
 * D · Hold the button for the rest of the window. The countdown runs to the end
 * of the CURRENT bucket, not 60s from the press, because that is when a new key
 * becomes available — so the button re-enables exactly when a second send would
 * actually be delivered, and the product never makes a claim it cannot keep.
 */
function VariantD({ onLog }: { onLog: (entry: LogEntry) => void }) {
  const { pending, last, press } = useStubbedResend("d", true, onLog);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!last) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [last]);

  // The ticker only starts on the next interval, so until it fires the press's
  // own timestamp is the basis — otherwise the button flashes enabled for a
  // quarter of a second right after a send.
  const basis = last ? Math.max(now, last.at) : 0;
  const secondsLeft = basis ? Math.ceil(msLeftInWindow(basis) / 1000) : 0;
  const held = Boolean(last) && secondsLeft > 0;
  const claimFor = (send: Send) => `Email sent at ${minuteLabel(send.at)}`;

  return (
    <Row>
      <div className="flex items-center gap-2">
        {last && !pending && (
          <span role="status" className="text-muted-foreground text-xs">
            {claimFor(last)}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={pending || held}
          onClick={() => press(claimFor)}
        >
          {pending
            ? "Sending…"
            : held
              ? `Resend in ${secondsLeft}s`
              : "Resend email"}
        </Button>
      </div>
    </Row>
  );
}

export function ResendPrototypeBench() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const onLog = (entry: LogEntry) => setLog((prev) => [entry, ...prev]);

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>
          Prototype bench — what should a resend inside the dedupe window say?
        </CardTitle>
        <CardDescription>
          Press <strong>Resend email</strong> twice, fast. No email is sent: the
          transport is stubbed, but it reproduces the real key (
          <code>org-invitation-&lt;id&gt;-resend-&lt;floor(now/60000)&gt;</code>
          ) and drops a repeat exactly as Resend does. The log shows what the
          screen claimed next to what the provider actually did. Flip options
          with the switcher at the bottom of the page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-border divide-y">
          <div className="hidden [[data-resend-proto=a]_&]:block">
            <VariantA onLog={onLog} />
          </div>
          <div className="hidden [[data-resend-proto=b]_&]:block">
            <VariantB onLog={onLog} />
          </div>
          <div className="hidden [[data-resend-proto=c]_&]:block">
            <VariantC onLog={onLog} />
          </div>
          <div className="hidden [[data-resend-proto=d]_&]:block">
            <VariantD onLog={onLog} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Provider log
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="cursor-pointer"
            onClick={() => setLog([])}
          >
            Clear log
          </Button>
        </div>

        {log.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            Nothing pressed yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {log.map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2 text-xs"
              >
                <span className="font-mono">{clock(entry.at)}</span>
                <Badge variant={entry.delivered ? "secondary" : "destructive"}>
                  {entry.delivered
                    ? "provider: delivered"
                    : "provider: DROPPED as duplicate"}
                </Badge>
                <span>
                  screen said: <strong>{entry.claim}</strong>
                </span>
                <span className="text-muted-foreground font-mono break-all">
                  {entry.key}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
