import { z } from "zod";

import { EVRY_PEOPLE_READ_PROBE_IDENTITY } from "@/lib/evry/eligibility/capabilities";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import {
  createEvryExecutionCapabilityRegistry,
  defineEvryExecutionCapability,
  type EvryEffectInput,
  type EvryEffectResult,
} from "@/lib/evry/executor";
import { defineEvryPlanCapability } from "@/lib/evry/plans";

import {
  createEvryRecipeRegistry,
  defineEvryRecipePrecondition,
  defineEvryRecipeResolver,
  type EvryRecipeResolvedInputs,
  type EvryRecipeRegistry,
} from "./schema";

export const CREATE_MEETING_IDENTITY = "meetings.create";
export const ADD_GUESTS_IDENTITY = "meetings.add-guests";
export const SEND_MESSAGE_IDENTITY = "communication.messages.send";
export const RECIPE_IDENTITY = "fixture:meeting.invitation";
export const RESOLVER_IDENTITY = "fixture:people.resolve";
export const PRECONDITION_IDENTITY = "fixture:audience.present";

export const FIXTURE_RESOLVED_PERSON_IDS = Object.freeze([
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
]);

export const FIXTURE_RECIPE_VALUES = Object.freeze({
  meeting_id: "10000000-0000-4000-8000-000000000001",
  starts_at: "2026-09-02T14:00:00-04:00",
  person_ids: "Alex and Beth",
  recipient_ids: ["30000000-0000-4000-8000-000000000001"],
  subject: "Vision Meeting",
  body: "Please join us.",
});

export function fixtureRecipeDefinition(): Record<string, unknown> {
  return {
    identity: RECIPE_IDENTITY,
    requiredInputs: [
      { key: "meeting_id", schema: z.string().uuid() },
      { key: "starts_at", schema: z.string().datetime({ offset: true }) },
      { key: "person_ids", schema: z.array(z.string().uuid()).min(1) },
      { key: "recipient_ids", schema: z.array(z.string().uuid()).min(1) },
      { key: "subject", schema: z.string().min(1) },
      { key: "body", schema: z.string().min(1) },
    ],
    optionalInputs: [{ key: "internal_note", schema: z.string().min(1) }],
    recordResolvers: [
      { inputKey: "person_ids", resolverIdentity: RESOLVER_IDENTITY },
    ],
    preconditions: [PRECONDITION_IDENTITY],
    eligibleCapabilities: [
      CREATE_MEETING_IDENTITY,
      ADD_GUESTS_IDENTITY,
      SEND_MESSAGE_IDENTITY,
    ],
    confirmation: {
      title: "Create meeting and send invitations",
      actionLabel: "Create meeting and send 1",
    },
    steps: [
      {
        id: "create-meeting",
        capabilityIdentity: CREATE_MEETING_IDENTITY,
        arguments: {
          meetingId: { kind: "input", inputKey: "meeting_id" },
          startsAt: { kind: "input", inputKey: "starts_at" },
        },
        dependsOn: [],
        disclosure: {
          title: "Create the meeting",
          items: [
            {
              label: "Meeting",
              value: { kind: "argument", argumentKey: "meetingId" },
            },
            {
              label: "Starts",
              value: { kind: "argument", argumentKey: "startsAt" },
            },
          ],
          consequences: ["Adds one meeting to the plant calendar."],
        },
        failurePolicy: { retry: "same_plan" },
      },
      {
        id: "add-guests",
        capabilityIdentity: ADD_GUESTS_IDENTITY,
        arguments: {
          meetingId: { kind: "input", inputKey: "meeting_id" },
          personIds: { kind: "input", inputKey: "person_ids" },
        },
        dependsOn: ["create-meeting"],
        disclosure: {
          title: "Add resolved guests",
          items: [
            {
              label: "Meeting",
              value: { kind: "argument", argumentKey: "meetingId" },
            },
            {
              label: "People",
              value: { kind: "argument", argumentKey: "personIds" },
            },
          ],
          consequences: ["Adds two people to the meeting guest list."],
        },
        failurePolicy: { retry: "same_plan" },
      },
      {
        id: "send-invitations",
        capabilityIdentity: SEND_MESSAGE_IDENTITY,
        arguments: {
          meetingId: { kind: "input", inputKey: "meeting_id" },
          recipientIds: { kind: "input", inputKey: "recipient_ids" },
          subject: { kind: "input", inputKey: "subject" },
          body: { kind: "input", inputKey: "body" },
          internalNote: { kind: "input", inputKey: "internal_note" },
        },
        dependsOn: ["create-meeting"],
        disclosure: {
          title: "Send the invitations",
          items: [
            {
              label: "Meeting",
              value: { kind: "argument", argumentKey: "meetingId" },
            },
            {
              label: "Recipients",
              value: { kind: "argument", argumentKey: "recipientIds" },
            },
            {
              label: "Subject",
              value: { kind: "argument", argumentKey: "subject" },
            },
            {
              label: "Message",
              value: { kind: "argument", argumentKey: "body" },
            },
            {
              label: "Internal note",
              value: {
                kind: "argument",
                argumentKey: "internalNote",
                absentValue: "None",
              },
            },
          ],
          consequences: ["Sends one outbound email."],
        },
        failurePolicy: { retry: "same_plan" },
      },
    ],
  };
}

export function createFixtureRecipeRegistry(
  execute: (
    identity: string,
    input: EvryEffectInput
  ) => Promise<EvryEffectResult> = async () => ({
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  }),
  definitions: readonly unknown[] = [fixtureRecipeDefinition()],
  recipeBoundaries: Readonly<{
    resolve?: (
      rawValue: unknown,
      authorization: EvryReadCapabilityAuthorization
    ) => unknown | Promise<unknown>;
    check?: (inputs: EvryRecipeResolvedInputs) => boolean | Promise<boolean>;
  }> = {}
): EvryRecipeRegistry {
  const planCapabilities = [
    defineEvryPlanCapability({
      identity: CREATE_MEETING_IDENTITY,
      effectClass: "database_write",
      arguments: {
        meetingId: z.string().uuid(),
        startsAt: z.string().datetime({ offset: true }),
      },
    }),
    defineEvryPlanCapability({
      identity: ADD_GUESTS_IDENTITY,
      effectClass: "database_write",
      arguments: {
        meetingId: z.string().uuid(),
        personIds: z.array(z.string().uuid()).min(1),
      },
    }),
    defineEvryPlanCapability({
      identity: SEND_MESSAGE_IDENTITY,
      effectClass: "outbound_communication",
      arguments: {
        meetingId: z.string().uuid(),
        recipientIds: z.array(z.string().uuid()).min(1),
        subject: z.string().min(1),
        body: z.string().min(1),
        internalNote: z.string().min(1).optional(),
      },
    }),
  ];
  const executionRegistry = createEvryExecutionCapabilityRegistry(
    planCapabilities.map((planCapability) =>
      defineEvryExecutionCapability({
        planCapability,
        executeIfCurrent: (input) => execute(planCapability.identity, input),
      })
    )
  );
  return createEvryRecipeRegistry({
    executionRegistry,
    resolvers: [
      defineEvryRecipeResolver({
        identity: RESOLVER_IDENTITY,
        readCapabilityIdentity: EVRY_PEOPLE_READ_PROBE_IDENTITY,
        async resolve({ authorization, rawValue }) {
          return recipeBoundaries.resolve
            ? recipeBoundaries.resolve(rawValue, authorization)
            : FIXTURE_RESOLVED_PERSON_IDS;
        },
      }),
    ],
    preconditions: [
      defineEvryRecipePrecondition({
        identity: PRECONDITION_IDENTITY,
        check(inputs) {
          return recipeBoundaries.check
            ? recipeBoundaries.check(inputs)
            : Array.isArray(inputs.person_ids) && inputs.person_ids.length > 0;
        },
      }),
    ],
    definitions,
  });
}
