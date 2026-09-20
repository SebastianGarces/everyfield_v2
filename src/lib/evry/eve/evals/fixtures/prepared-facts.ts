import { z } from "zod";
import type { Expectations } from "../contract";
import type { FixtureManifest } from "./manifest";
import type { FixtureStore } from "./store";
import type { CapturedCall } from "./host-capture";
import { richTextToPlainText } from "@/lib/rich-text/format";

export function orientationTemplateExpectations(
  m: FixtureManifest,
  store: FixtureStore
): Expectations["facts"] {
  const row = z
    .object({ subject: z.string(), body: z.string() })
    .parse(
      store.query(
        `select subject,body from message_templates where id='${m.ids["orientation-template"]}' and church_id='${m.ids.plant}'`
      )[0]
    );
  return {
    templateSubject: row.subject,
    templateBody: richTextToPlainText(row.body),
  };
}

/** Project only an exact persisted, unconfirmed plan returned by the trusted host. */
export async function readPreparedOrientationFacts(input: {
  manifest: FixtureManifest;
  store: FixtureStore;
  calls: readonly CapturedCall[];
  presented: ReadonlySet<string>;
}): Promise<Expectations["facts"]> {
  const call = input.calls
    .filter(
      (entry) =>
        entry.name === "actions.prepare" && input.presented.has(entry.id)
    )
    .at(-1);
  const reference = z
    .object({
      activePlan: z.object({
        mode: z.literal("set"),
        plan: z.object({
          planId: z.uuid(),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      }),
    })
    .safeParse(call?.output);
  if (!reference.success) return {};
  const { planId, fingerprint } = reference.data.activePlan.plan;
  const m = input.manifest;
  const rows = input.store
    .query(`select p.document,p.expires_at::text from evry_action_plans p join evry_action_plan_states s on s.plan_id=p.id and s.church_id=p.church_id
    where p.id='${planId}' and p.fingerprint='${fingerprint}' and p.actor_user_id='${m.ids.actor}' and p.church_id='${m.ids.plant}' and s.status='awaiting_confirmation'
    and p.expires_at > '${m.now}'::timestamptz
    and not exists(select 1 from evry_plan_confirmations c where c.plan_id=p.id)`);
  if (rows.length !== 1) return {};
  const row = z
    .object({ document: z.unknown(), expires_at: z.string() })
    .parse(rows[0]);
  const [
    { parseStoredEvryActionPlan, fingerprintEvryActionPlan },
    { PRODUCTION_EVRY_PLAN_REGISTRY },
    { MEETINGS_EFFECT_ARGUMENT_SCHEMAS },
    { MEETING_GUEST_BATCH_ARGUMENT_SCHEMA },
    { COMMUNICATION_MESSAGE_SEND_ARGUMENT_SCHEMA },
    { toCalendarDate },
  ] = await Promise.all([
    import("@/lib/evry/plans"),
    import("@/lib/evry/capabilities/execution"),
    import("@/lib/evry/capabilities/meetings/effect-contracts"),
    import("@/lib/evry/capabilities/meetings/dependency-output"),
    import("@/lib/evry/capabilities/communication/messages"),
    import("@/lib/datetime"),
  ]);
  const document = parseStoredEvryActionPlan({
    document: row.document,
    registry: PRODUCTION_EVRY_PLAN_REGISTRY,
  });
  if (
    fingerprintEvryActionPlan({
      actorUserId: m.ids.actor,
      plantId: m.ids.plant,
      expiresAt: new Date(row.expires_at),
      document,
    }) !== fingerprint
  )
    return {};
  if (
    document.steps.length !== 3 ||
    document.steps[0]?.capabilityIdentity !== "meetings.create" ||
    document.steps[1]?.capabilityIdentity !== "meetings.add-guests" ||
    document.steps[2]?.capabilityIdentity !== "communication.messages.send"
  )
    return {};
  const meeting = MEETINGS_EFFECT_ARGUMENT_SCHEMAS.createMeetingAction.parse(
    document.steps[0].arguments
  );
  const guests = MEETING_GUEST_BATCH_ARGUMENT_SCHEMA.parse(
    document.steps[1].arguments
  );
  const message = COMMUNICATION_MESSAGE_SEND_ARGUMENT_SCHEMA.parse(
    document.steps[2].arguments
  );
  const recipientIds = message.audience.recipients
    .map((person) => person.personId)
    .sort();
  if (
    JSON.stringify(guests.targets.map((person) => person.personId).sort()) !==
    JSON.stringify(recipientIds)
  )
    return {};
  const instant = new Date(meeting.datetime);
  // The production Meetings executor persists UTC-pinned wall clocks into a
  // timestamp-without-time-zone column, not instants (atomic-effect.ts).
  // The separate timezone identifies which church-local clock these fields use.
  return {
    meetingType: meeting.type,
    localDate: toCalendarDate(instant),
    localTime: new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant),
    timezone: meeting.timezone,
    durationMinutes: meeting.durationMinutes,
    recipientIds,
    // savedLocationId is only populated when this plan creates a NEW location.
    locationId: meeting.locationId,
    templateSubject: message.audience.subject,
    templateBody: richTextToPlainText(message.audience.body),
  };
}
