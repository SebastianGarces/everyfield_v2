import { createHash } from "node:crypto";
import { createElement } from "react";
import { Heading, Link, Text, render } from "@react-email/components";
import type { User } from "@/db/schema/user";
import type { AssociationOrgType } from "@/db/schema/association-event";
import { isOrgOwner, oversightOrgOf } from "@/lib/auth/tenancy";
import { BaseLayout } from "@/lib/email/components/base-layout";
import { appBaseUrl } from "@/lib/notifications/channels/email";
import { OVERSIGHT_ADMIN_ROWS } from "@/lib/notifications/oversight-admin";

export type DiscoveryAssociationChange = {
  userId: string;
  orgType: AssociationOrgType;
  orgId: string;
  event: "accepted" | "declined" | "left" | "removed";
  /** Durable event/answer identity from the winning mutation, reused on retry. */
  occurrence: string;
};

type Account = Pick<User, "id" | "email" | "name">;
type OwnerCandidate = Pick<
  User,
  "id" | "email" | "seat" | "churchId" | "sendingChurchId" | "sendingNetworkId"
>;
type NoticeFacts = {
  account: Account;
  orgName: string;
  ownerCandidates: OwnerCandidate[];
};
type Message = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};
type NoticeDeps = {
  load?: (change: DiscoveryAssociationChange) => Promise<NoticeFacts | null>;
  send?: (message: Message) => Promise<{ success: boolean }>;
  baseUrl?: string;
};

async function loadFacts(
  change: DiscoveryAssociationChange
): Promise<NoticeFacts | null> {
  const [
    { db },
    { users, sendingChurches, sendingNetworks },
    { eq },
    { OVERSIGHT_ADMIN },
  ] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("drizzle-orm"),
    import("@/lib/notifications/oversight-admin"),
  ]);
  const orgTable =
    change.orgType === "sending_church" ? sendingChurches : sendingNetworks;
  const [[account], [org], ownerCandidates] = await Promise.all([
    db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, change.userId)),
    db
      .select({ name: orgTable.name })
      .from(orgTable)
      .where(eq(orgTable.id, change.orgId)),
    // Probe everyone this FK reaches so defective tenancies are counted below.
    db
      .select({
        id: users.id,
        email: users.email,
        seat: users.seat,
        churchId: users.churchId,
        sendingChurchId: users.sendingChurchId,
        sendingNetworkId: users.sendingNetworkId,
      })
      .from(users)
      .where(eq(users[OVERSIGHT_ADMIN[change.orgType].fk], change.orgId)),
  ]);
  return account && org
    ? { account, orgName: org.name, ownerCandidates }
    : null;
}

async function sendNotice(message: Message) {
  const { sendEmail, EMAIL_REPLY_TO } = await import("@/lib/email/client");
  return sendEmail({ ...message, replyTo: EMAIL_REPLY_TO });
}

/**
 * Postcommit receipt of a winning discovery association change, never a public
 * action or an authorization check. The caller owns the audit/answer lifecycle.
 * Seatless accounts receive transactional email through the shared sender;
 * no church, notification row or second persisted delivery system is invented.
 * Provider deduplication is bounded by its retention window, not exactly-once.
 */
export async function announceDiscoveryAssociationChange(
  change: DiscoveryAssociationChange,
  deps: NoticeDeps = {}
): Promise<{ sent: number; failed: number }> {
  try {
    const facts = await (deps.load ?? loadFacts)(change);
    if (!facts || facts.account.id !== change.userId) {
      console.error(
        "Discovery association notice could not resolve its recipients"
      );
      return { sent: 0, failed: 1 };
    }
    const recipients = new Map<
      string,
      { id: string; email: string; audience: "discovery" | "owner" }
    >([
      [
        facts.account.id,
        {
          id: facts.account.id,
          email: facts.account.email,
          audience: "discovery",
        },
      ],
    ]);
    const defective: { id: string; names: string[] }[] = [];
    for (const candidate of facts.ownerCandidates) {
      const org = oversightOrgOf(candidate);
      if (!org) {
        defective.push({
          id: candidate.id,
          names: [
            "churchId" as const,
            ...OVERSIGHT_ADMIN_ROWS.map(([, pair]) => pair.fk),
          ].filter((column) => candidate[column] !== null),
        });
        continue;
      }
      if (
        isOrgOwner(candidate) &&
        org.type === change.orgType &&
        org.id === change.orgId &&
        candidate.id !== facts.account.id
      ) {
        recipients.set(candidate.id, {
          id: candidate.id,
          email: candidate.email,
          audience: "owner",
        });
      }
    }
    if (defective.length)
      console.error(
        "Discovery association notice excluded defective tenancies",
        { count: defective.length, rows: defective }
      );
    const orgLabel =
      change.orgType === "sending_church" ? "sending church" : "network";
    const subject = {
      accepted: "Discovery association accepted",
      declined: "Discovery association invitation declined",
      left: "Discovery association ended",
      removed: "Discovery association ended",
    }[change.event];
    const outcome = { sent: 0, failed: 0 };
    for (const recipient of recipients.values()) {
      try {
        const person =
          recipient.audience === "discovery"
            ? "You"
            : facts.account.name || facts.account.email;
        const relationship = `${facts.orgName} (${orgLabel})`;
        const body = {
          accepted: `${person} accepted a discovery association with ${relationship}.`,
          declined: `${person} declined the discovery association invitation from ${relationship}.`,
          left: `${person} left the discovery association with ${relationship}.`,
          removed: `${relationship} ended ${recipient.audience === "discovery" ? "your" : `${person}'s`} discovery association.`,
        }[change.event];
        const href = `${deps.baseUrl ?? appBaseUrl()}${recipient.audience === "discovery" ? "/dashboard" : "/oversight"}`;
        const element = createElement(BaseLayout, {
          preview: subject,
          children: [
            createElement(
              Heading,
              { key: "title", style: { fontSize: "22px", lineHeight: "28px" } },
              subject
            ),
            createElement(
              Text,
              { key: "body", style: { fontSize: "16px", lineHeight: "24px" } },
              body
            ),
            createElement(Link, { key: "link", href }, "Open EveryField"),
          ],
        });
        const idempotencyKey = `discovery-association-${createHash("sha256")
          .update(
            JSON.stringify([
              change.userId,
              change.orgType,
              change.orgId,
              change.event,
              change.occurrence,
              recipient.id,
            ])
          )
          .digest("hex")}`;
        const sent = await (deps.send ?? sendNotice)({
          to: recipient.email,
          subject,
          idempotencyKey,
          html: await render(element),
          text: await render(element, { plainText: true }),
        });
        if (sent.success) outcome.sent++;
        else {
          outcome.failed++;
          console.error("Discovery association notice provider refused");
        }
      } catch {
        // A transport exception can quote addresses or the payload. Log neither.
        outcome.failed++;
        console.error("Discovery association notice delivery failed");
      }
    }
    return outcome;
  } catch {
    console.error("Discovery association notice preparation failed");
    return { sent: 0, failed: 1 };
  }
}
