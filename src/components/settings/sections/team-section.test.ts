import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { assertInOrder, stripComments } from "@/lib/testing/source-span";

// ---------------------------------------------------------------------------
// THE TEAM SECTION'S READING ORDER (#725).
//
// A plant Owner audits who already reaches the plant before inviting anyone
// else. The forms deliberately stay on this screen, after the existing seats
// and (when applicable) coaches — moving them must not change their props,
// actions, or the invitation history below them.
// ---------------------------------------------------------------------------

const TEAM_SECTION = path.join(
  process.cwd(),
  "src",
  "components",
  "settings",
  "sections",
  "team-section.tsx"
);

test("the roster precedes invitations, with coaches beside seats", () => {
  const source = stripComments(readFileSync(TEAM_SECTION, "utf8"));

  assertInOrder(
    source,
    "team-section.tsx",
    [
      "<SeatRoster",
      "<PlantCoachList",
      "<SeatInviteForm",
      "<CoachInviteForm",
      "rows={view.seatInvitations}",
      "rows={view.coachInvitations}",
    ],
    "a plant's Team section must show its access roster before the unchanged invitation forms and history"
  );
});

test("the reordered sections keep their existing props, gates, and actions", () => {
  const source = stripComments(readFileSync(TEAM_SECTION, "utf8"));

  assert.match(
    source,
    /<SeatRoster\s+rows=\{view\.roster\}\s+canManageSeats=\{view\.canManageSeats\}\s+tenancyType=\{view\.tenancyType\}\s+actions=\{\{\s+appoint: appointAdminAction,\s+demote: demoteToMemberAction,\s+remove: removeSeatAction,\s+\}\}\s+\/>/,
    "the seat roster must retain its rows, capability, tenancy noun, and three seat actions"
  );
  assert.match(
    source,
    /\{view\.isPlant && \(\s*<PlantCoachList\s+rows=\{view\.coaches\}\s+canEndAssignments=\{view\.canEndAssignments\}\s+endAssignment=\{endCoachAssignmentAction\}\s+\/>\s*\)\}/,
    "the coach roster must remain plant-gated with its rows, capability, and end action"
  );
  assert.match(
    source,
    /<SeatInviteForm\s+expiryDays=\{view\.expiryDays\}\s+tenancyType=\{view\.tenancyType\}\s+\/>/,
    "the team invitation form must retain its expiry and tenancy props"
  );
  assert.match(
    source,
    /\{view\.isPlant && <CoachInviteForm expiryDays=\{view\.expiryDays\} \/>\}/,
    "the coach invitation form must remain plant-gated with its expiry prop"
  );
  assert.match(
    source,
    /<InvitationsList\s+rows=\{view\.seatInvitations\}\s+container="block"\s+actions=\{\{\s+resend: resendSeatInvitationEmailAction,\s+revoke: revokeSeatInvitationAction,\s+\}\}/,
    "the seat invitation history must retain its resend and revoke actions"
  );
  assert.match(
    source,
    /\{view\.isPlant && view\.coachInvitations\.length > 0 && \(\s*<InvitationsList\s+rows=\{view\.coachInvitations\}\s+container="block"\s+actions=\{\{\s+resend: resendSeatInvitationEmailAction,\s+revoke: revokeSeatInvitationAction,\s+\}\}/,
    "the coach invitation history must remain plant-gated, nonempty-only, and bound to its resend and revoke actions"
  );
});
