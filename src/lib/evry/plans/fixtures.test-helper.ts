import { z } from "zod";

import {
  createEvryPlanCapabilityRegistry,
  defineEvryPlanCapability,
} from "./registry";
import { parseEvryActionPlanCandidate } from "./schema";

export const MEETING_IDENTITY = "fixture:meeting.create";
export const SEND_IDENTITY = "fixture:communication.send";

export const PLAN_FIXTURE_REGISTRY = createEvryPlanCapabilityRegistry([
  defineEvryPlanCapability({
    identity: MEETING_IDENTITY,
    effectClass: "database_write",
    arguments: {
      startsAt: z.string().datetime({ offset: true }),
      locationId: z.string().uuid(),
      targetId: z.string().uuid(),
      reminderDays: z.number().int().nonnegative(),
    },
  }),
  defineEvryPlanCapability({
    identity: SEND_IDENTITY,
    effectClass: "outbound_communication",
    arguments: {
      recipientIds: z.array(z.string().uuid()).min(1),
      subject: z.string().min(1),
      body: z.string().min(1),
    },
  }),
]);

export const ELIGIBLE_FIXTURE_CAPABILITIES = [
  { identity: MEETING_IDENTITY },
  { identity: SEND_IDENTITY },
] as const;

export const FIXTURE_IDS = {
  target: "10000000-0000-4000-8000-000000000001",
  location: "20000000-0000-4000-8000-000000000001",
  recipientOne: "30000000-0000-4000-8000-000000000001",
  recipientTwo: "30000000-0000-4000-8000-000000000002",
} as const;

export function fixtureCandidate(): unknown {
  return {
    steps: [
      {
        id: "create-meeting",
        capabilityIdentity: MEETING_IDENTITY,
        arguments: {
          startsAt: "2026-09-02T14:00:00-04:00",
          locationId: FIXTURE_IDS.location,
          targetId: FIXTURE_IDS.target,
          reminderDays: 2,
        },
        dependsOn: [],
      },
      {
        id: "send-invitation",
        capabilityIdentity: SEND_IDENTITY,
        arguments: {
          recipientIds: [FIXTURE_IDS.recipientOne],
          subject: "Vision Meeting",
          body: "Please join us.",
        },
        dependsOn: ["create-meeting"],
      },
    ],
  };
}

export function fixtureDocument() {
  return parseEvryActionPlanCandidate({
    candidate: fixtureCandidate(),
    registry: PLAN_FIXTURE_REGISTRY,
    eligibleCapabilities: ELIGIBLE_FIXTURE_CAPABILITIES,
  });
}
