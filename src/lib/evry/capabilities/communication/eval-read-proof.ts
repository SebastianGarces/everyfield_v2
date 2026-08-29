import assert from "node:assert/strict";
import { mock } from "node:test";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const PLANT_ID = "20000000-0000-4000-8000-000000000001";
const RECORD_ID = "30000000-0000-4000-8000-000000000001";
const FOREIGN_ID = "30000000-0000-4000-8000-000000000099";
const NOW = new Date("2026-08-29T12:00:00.000Z");
type SessionSeat = "owner" | "member";

let sessionSeat: SessionSeat = "owner";

function session() {
  return {
    user: {
      id: ACTOR_ID,
      churchId: PLANT_ID,
      sendingChurchId: null,
      sendingNetworkId: null,
      seat: sessionSeat,
    },
  };
}

const calls: Array<Readonly<{ operation: string; plantId: string }>> = [];
function scoped(operation: string, plantId: string) {
  calls.push({ operation, plantId });
  assert.equal(plantId, PLANT_ID);
}

const person = {
  id: RECORD_ID,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.test",
  status: "leader",
};
const template = {
  id: RECORD_ID,
  churchId: PLANT_ID,
  name: "Follow up",
  description: "A safe fixture",
  category: "follow_up",
  channel: "email",
  subject: "Hello",
  body: "Welcome",
  bodyHtml: "<p>Welcome</p>",
  mergeFields: [],
  isSystem: false,
  sourceTemplateId: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const communication = {
  id: RECORD_ID,
  churchId: PLANT_ID,
  subject: "Hello",
  body: "Welcome",
  bodyHtml: "<p>Welcome</p>",
  channel: "email",
  templateId: null,
  meetingId: null,
  status: "sent",
  scheduledAt: null,
  sentAt: NOW,
  recipientCount: 1,
  createdById: ACTOR_ID,
  createdAt: NOW,
  updatedAt: NOW,
  stats: {
    total: 1,
    delivered: 1,
    opened: 0,
    clicked: 0,
    bounced: 0,
    failed: 0,
  },
};

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => session(),
    verifyFreshSession: async () => session(),
  },
});

mock.module("@/db", { namedExports: { db: {} } });

mock.module("@/lib/communication/service", {
  namedExports: {
    async getChurchDeliveryTotals(plantId: string) {
      scoped("delivery-totals", plantId);
      return {
        sent: 1,
        delivered: 1,
        opened: 0,
        clicked: 0,
        bounced: 0,
        failed: 0,
      };
    },
    async getCommunication(plantId: string, id: string) {
      scoped("communication", plantId);
      return id === RECORD_ID ? communication : null;
    },
    async getCommunicationRecipients(plantId: string, id: string) {
      scoped("communication-recipients", plantId);
      return id === RECORD_ID
        ? [
            {
              id: RECORD_ID,
              personId: RECORD_ID,
              email: person.email,
              status: "delivered",
              person,
            },
          ]
        : [];
    },
    async getCommunications(
      plantId: string,
      input: { search?: string; limit: number }
    ) {
      scoped("communications", plantId);
      return {
        communications: input.search === "missing" ? [] : [communication],
        total: input.search === "missing" ? 0 : 1,
      };
    },
    async getMeetingCommunications(plantId: string, meetingId: string) {
      scoped("meeting-history", plantId);
      return meetingId === RECORD_ID ? [communication] : [];
    },
    async getMeetingTrackingByPerson(plantId: string, meetingId: string) {
      scoped("meeting-tracking", plantId);
      return meetingId === RECORD_ID
        ? new Map([
            [
              RECORD_ID,
              { status: "delivered", deliveredAt: NOW, openedAt: null },
            ],
          ])
        : new Map();
    },
    async getPersonCommunications(plantId: string, personId: string) {
      scoped("person-history", plantId);
      return personId === RECORD_ID
        ? [{ communication, recipient: { id: RECORD_ID, status: "delivered" } }]
        : [];
    },
    async resolveSubjects(plantId: string, rows: readonly { id: string }[]) {
      scoped("resolve-subjects", plantId);
      return new Map(rows.map(({ id }) => [id, "Hello"]));
    },
  },
});

mock.module("@/lib/communication/recipient-groups", {
  namedExports: {
    isRecipientGroupSelector: (group: string) =>
      ["core_group", "launch_team", "leaders", "prospects", "all"].includes(
        group
      ) || /^team:[0-9a-f-]{36}$/i.test(group),
    async getGroupRecipients(plantId: string, group: string) {
      scoped("recipient-group", plantId);
      return group === "leaders" ? [person] : [];
    },
    async listRecipientTeams(plantId: string) {
      scoped("recipient-teams", plantId);
      return [
        {
          id: RECORD_ID,
          name: "Leaders",
          selector: `team:${RECORD_ID}`,
          memberCount: 1,
        },
      ];
    },
  },
});

mock.module("@/lib/communication/resend-policy", {
  namedExports: {
    evaluateResendEligibility: () => ({ allowed: true }),
    resendBlockedHint: () => "Unavailable",
  },
});

mock.module("@/lib/communication/send", {
  namedExports: {
    async getNonOpenerSummary(plantId: string, id: string) {
      scoped("non-openers", plantId);
      return id === RECORD_ID
        ? { total: 1, delivered: 1, opened: 0, personIds: [RECORD_ID] }
        : { total: 0, delivered: 0, opened: 0, personIds: [] };
    },
  },
});

mock.module("@/lib/communication/templates", {
  namedExports: {
    async getTemplate(id: string, plantId: string) {
      scoped("template", plantId);
      return id === RECORD_ID ? template : undefined;
    },
    async getTemplates(plantId: string) {
      scoped("templates", plantId);
      return [template];
    },
  },
});

mock.module("@/lib/people/service", {
  namedExports: {
    async listPeople(plantId: string) {
      scoped("people", plantId);
      return { people: [person], total: 1 };
    },
  },
});

const selectionText: Record<string, string> = {
  "communication.compose.get-context": "Show compose context",
  "communication.delivery.get-church-totals": "Show delivery totals",
  "communication.delivery.get-meeting-tracking":
    "Show meeting delivery tracking",
  "communication.delivery.get-message": `Show message ${RECORD_ID}`,
  "communication.delivery.get-message-recipients": `Show recipients for message ${RECORD_ID}`,
  "communication.history.get-meeting": "Show communication for this meeting",
  "communication.history.get-person": "Show communication for this person",
  "communication.history.list": "List communication history",
  "communication.recipients.list-teams": "List recipient teams",
  "communication.recipients.resolve-group": "Resolve recipient group leaders",
  "communication.recipients.search-people":
    "Search communication recipients Ada",
  "communication.resends.get-eligible-non-openers": `Show resend eligibility for message ${RECORD_ID}`,
  "communication.templates.get": `Show template ${RECORD_ID}`,
  "communication.templates.list": "List communication templates",
};

const executionArguments: Record<string, Readonly<Record<string, string>>> = {
  "communication.compose.get-context": {},
  "communication.delivery.get-church-totals": {},
  "communication.delivery.get-meeting-tracking": { meetingId: RECORD_ID },
  "communication.delivery.get-message": { id: RECORD_ID },
  "communication.delivery.get-message-recipients": { id: RECORD_ID },
  "communication.history.get-meeting": { meetingId: RECORD_ID },
  "communication.history.get-person": { personId: RECORD_ID },
  "communication.history.list": { search: "" },
  "communication.recipients.list-teams": {},
  "communication.recipients.resolve-group": { group: "leaders" },
  "communication.recipients.search-people": { query: "Ada" },
  "communication.resends.get-eligible-non-openers": { id: RECORD_ID },
  "communication.templates.get": { id: RECORD_ID },
  "communication.templates.list": {},
};

async function main() {
  const [
    { COMMUNICATION_EVRY_READ_REGISTRATIONS, continueCommunicationEvryRead },
    capabilities,
  ] = await Promise.all([
    import("./reads"),
    import("@/lib/evry/eligibility/capabilities"),
  ]);
  const outcomes: Record<
    string,
    Readonly<{
      execution: boolean;
      idempotency: boolean;
      arguments: boolean;
      tenancy: boolean;
      permission: boolean;
      confirmation: boolean;
      errors: boolean;
      uiArtifact: boolean;
    }>
  > = {};

  for (const registration of COMMUNICATION_EVRY_READ_REGISTRATIONS) {
    calls.length = 0;
    const identity = registration.capabilityIdentity;
    const literalUserText = selectionText[identity];
    assert.ok(literalUserText, `missing read proof input for ${identity}`);
    const eligible = capabilities.evryCapabilityRegistrationFor(identity);
    assert.ok(eligible?.operationKind === "read");
    const pageContext = identity.endsWith("get-person")
      ? { kind: "person" as const, recordId: RECORD_ID, label: "Ada" }
      : identity.endsWith("get-meeting") ||
          identity.endsWith("get-meeting-tracking")
        ? { kind: "meeting" as const, recordId: RECORD_ID, label: "Meeting" }
        : null;
    const input = {
      eligibleCapabilities: [eligible],
      literalUserText,
      pageContext,
    };
    const first = await continueCommunicationEvryRead(input);
    const second = await continueCommunicationEvryRead(input);
    assert.ok(first?.kind === "read", identity);
    assert.deepEqual(second, first, identity);
    assert.equal(
      await continueCommunicationEvryRead({
        ...input,
        eligibleCapabilities: [],
      }),
      null
    );
    assert.equal(
      await registration.execute(
        { literalUserText, pageContext },
        { unexpected: true }
      ),
      null
    );
    sessionSeat = "member";
    const authorizedArguments = executionArguments[identity];
    assert.ok(authorizedArguments, `missing read arguments for ${identity}`);
    assert.ok(
      await registration.execute(
        { literalUserText, pageContext },
        authorizedArguments
      ),
      `${identity} should remain readable to a seated member`
    );
    sessionSeat = "owner";
    assert.ok(calls.length > 0, `${identity} performed no product read`);
    assert.ok(calls.every(({ plantId }) => plantId === PLANT_ID));
    outcomes[identity] = {
      execution: true,
      idempotency: true,
      arguments: true,
      tenancy: true,
      permission: true,
      confirmation: true,
      errors: true,
      uiArtifact: first.title.trim().length > 0,
    };
  }

  // Foreign record ids use the same scoped adapters and expose no foreign row.
  for (const literalUserText of [
    `Show message ${FOREIGN_ID}`,
    `Show recipients for message ${FOREIGN_ID}`,
    `Show resend eligibility for message ${FOREIGN_ID}`,
    `Show template ${FOREIGN_ID}`,
  ]) {
    const selectionIdentity = Object.entries(selectionText).find(([, text]) =>
      text.replaceAll(RECORD_ID, FOREIGN_ID).includes(literalUserText)
    )?.[0];
    assert.ok(selectionIdentity);
    const eligible =
      capabilities.evryCapabilityRegistrationFor(selectionIdentity);
    assert.ok(eligible?.operationKind === "read");
    const result = await continueCommunicationEvryRead({
      eligibleCapabilities: [eligible],
      literalUserText,
      pageContext: null,
    });
    assert.ok(result?.kind === "read");
    assert.doesNotMatch(JSON.stringify(result), /Foreign/);
  }

  process.stdout.write(
    `EVRY_COMMUNICATION_READ_OUTCOMES=${JSON.stringify(outcomes)}\n`
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
