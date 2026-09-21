import assert from "node:assert/strict";
import { test } from "node:test";
import {
  invitationActorFromSession,
  invitationView,
  resolveInvitationForResolvedTarget,
  requireAssociationPair,
} from "@/lib/invitations/core";
import { discoverySubject, toSubjectColumns } from "@/lib/invitations/audit";
import type { OrganizationInvitation } from "@/db/schema";

const userId = "11111111-1111-4111-8111-111111111111";
const orgId = "22222222-2222-4222-8222-222222222222";
const manager = invitationActorFromSession({
  user: {
    id: "33333333-3333-4333-8333-333333333333",
    seat: "owner",
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: orgId,
  },
});

test("only server resolution can target a discovery account", () => {
  const request = {
    inviteeEmail: "explorer@example.test",
    targetUserId: userId,
  };
  const open = resolveInvitationForResolvedTarget(manager, request, {});
  assert.ok(open.ok);
  assert.equal(open.values.targetUserId, null);
  assert.equal(open.values.type, "church_to_network");
  const discovery = resolveInvitationForResolvedTarget(manager, request, {
    targetUserId: userId,
  });
  assert.ok(discovery.ok);
  assert.equal(discovery.values.targetUserId, userId);
  assert.equal(discovery.values.type, "discovery_to_network");
});

test("public invitation response does not reveal discovery account existence", () => {
  const invitation: OrganizationInvitation = {
    id: "44444444-4444-4444-8444-444444444444",
    type: "discovery_to_network",
    inviterUserId: manager.id,
    inviteeEmail: "explorer@example.test",
    targetUserId: userId,
    targetChurchId: null,
    targetSendingChurchId: null,
    sendingChurchId: null,
    sendingNetworkId: orgId,
    status: "pending",
    respondedBy: null,
    respondedAt: null,
    createdAt: new Date(0),
    expiresAt: new Date(1),
  };
  assert.deepEqual(
    invitationView(invitation),
    invitationView({
      ...invitation,
      type: "church_to_network",
      targetUserId: null,
    })
  );
  assert.equal("targetUserId" in invitationView(invitation), false);
});

test("discovery audit retains user subject and refuses malformed association pairs", () => {
  assert.deepEqual(toSubjectColumns(discoverySubject(userId)), {
    subjectType: "discovery",
    discoveryUserId: userId,
    churchId: null,
    subjectSendingChurchId: null,
  });
  assert.throws(() =>
    requireAssociationPair({
      type: "discovery_to_network",
      targetUserId: userId,
      targetChurchId: orgId,
      targetSendingChurchId: null,
      sendingChurchId: null,
      sendingNetworkId: orgId,
    })
  );
  assert.deepEqual(
    requireAssociationPair({
      type: "discovery_to_network",
      targetUserId: userId,
      targetChurchId: null,
      targetSendingChurchId: null,
      sendingChurchId: null,
      sendingNetworkId: orgId,
    }),
    {
      type: "discovery_to_network",
      targetUserId: userId,
      sendingNetworkId: orgId,
    }
  );
});

test("org removal refuses malformed account ids before querying", async () => {
  const { removeDiscoveryFromOrgAs } = await import("./associations");
  await assert.rejects(
    removeDiscoveryFromOrgAs(manager, "-".repeat(36), "Explorer"),
    /cannot remove/
  );
});
