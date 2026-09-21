import assert from "node:assert/strict";
import { test } from "node:test";
import { selectCases } from "../catalog";
import type { CapturedCall } from "./host-capture";
import {
  communicationDeliveryFixtureIds,
  communicationDeliveryWindow,
  observedCommunicationDeliveryFacts,
} from "./communication-delivery";

const item = (id: string, fields: Record<string, string> = {}, label = id) => ({
  id,
  label,
  facts: Object.entries(fields).map(([label, value]) => ({ label, value })),
});
const read = (
  name: string,
  input: unknown,
  items: ReturnType<typeof item>[],
  matched = items.length,
  filters: { label: string; value: string }[] = []
): CapturedCall => ({
  id: `${name}-${JSON.stringify(input)}`,
  name,
  input,
  output: { kind: "read", counts: { matched }, items, filters },
});
const meeting = read("meetings.query", {}, [
  item("meeting", { "Local start": "2026-09-13T10:00:00" }),
]);
const recipients = (
  offset = 0,
  ids = ["sent", "delivered", "pending"],
  next?: number
) =>
  read(
    "communication.query",
    {
      query: {
        resource: "recipients",
        meetingIds: ["meeting"],
        limit: ids.length,
        offset,
      },
    },
    ids.map((id) =>
      item(id, {
        "Meeting ID": "meeting",
        "Delivery status": id[0]!.toUpperCase() + id.slice(1),
      })
    ),
    3,
    next === undefined ? [] : [{ label: "Next offset", value: String(next) }]
  );

test("delivery family binds five unchanged corpus prompts", () => {
  const cases = selectCases("full");
  assert.equal(new Set(communicationDeliveryFixtureIds).size, 5);
  assert.deepEqual(
    communicationDeliveryFixtureIds.map(
      (id) => cases.find((c) => c.id === id)?.turns[0]
    ),
    [
      "Did last Sunday's meeting invitations go out successfully?",
      "Which invitees have a delivery failure and also have not responded?",
      "Show all messages sent to Alex and Jordan in the past month.",
      "Find our orientation invitation template and show the placeholders.",
      "Show our orientation invitation template.",
    ]
  );
});
test("acceptance, delivery and unknown state remain distinct in full and paged evidence", () => {
  const full = observedCommunicationDeliveryFacts("communication-01", [
    meeting,
    recipients(),
  ]);
  assert.deepEqual(full.facts.deliveryCounts, [
    "delivered:1",
    "pending:1",
    "sent:1",
  ]);
  assert.deepEqual(
    full,
    observedCommunicationDeliveryFacts("communication-01", [
      meeting,
      recipients(0, ["sent"], 1),
      recipients(1, ["delivered"], 2),
      recipients(2, ["pending"]),
    ])
  );
  const grouped = read(
    "communication.query",
    {
      query: {
        resource: "recipients",
        mode: "group",
        groupBy: "status",
        meetingIds: ["meeting"],
      },
    },
    ["sent", "delivered", "pending"].map((id) =>
      item(id, { "Group ID": id, Count: "1" })
    ),
    3
  );
  assert.deepEqual(
    full,
    observedCommunicationDeliveryFacts("communication-01", [meeting, grouped])
  );
});
test("partial, stale, wrong-meeting and duplicate pages never establish complete delivery", () => {
  for (const calls of [
    [meeting, recipients(0, ["sent"], 1)],
    [meeting, recipients(), recipients(0, ["sent"], 1)],
    [
      meeting,
      recipients(),
      { ...recipients(), output: { status: "unavailable" } },
    ],
    [
      meeting,
      recipients(0, ["sent"], 1),
      recipients(1, ["sent"], 2),
      recipients(2, ["pending"]),
    ],
    [recipients()],
  ])
    assert.deepEqual(
      observedCommunicationDeliveryFacts("communication-01", calls).facts,
      {}
    );
});
test("RSVP intersection is person AND meeting; missing attendance and null RSVP remain distinct from responses", () => {
  const failures = read(
    "communication.query",
    { query: { resource: "recipients" } },
    [
      item("r1", {
        "Person ID": "p1",
        "Meeting ID": "meeting",
        "Delivery status": "Failed",
        Failure: "Refused",
      }),
      item("r2", {
        "Person ID": "p2",
        "Meeting ID": "meeting",
        "Delivery status": "Failed",
        Failure: "Refused",
      }),
      item("r3", {
        "Person ID": "p3",
        "Meeting ID": "meeting",
        "Delivery status": "Bounced",
        Failure: "Bad address",
      }),
      item("r4", {
        "Person ID": "p4",
        "Meeting ID": "meeting",
        "Delivery status": "Pending",
        Failure: "Unknown",
      }),
    ]
  );
  const attendance = read(
    "attendance.query",
    { result: { mode: "list" } },
    [
      item("a1", { person_id: "p1", meeting_id: "other", RSVP: "Confirmed" }),
      item("a2", { person_id: "p2", meeting_id: "meeting", RSVP: "Declined" }),
    ],
    2,
    [{ label: "Next page cursor", value: "End of results" }]
  );
  assert.deepEqual(
    observedCommunicationDeliveryFacts("communication-02", [
      failures,
      attendance,
    ]).facts.unansweredFailures,
    ["r1:p1:meeting:failed:Refused", "r3:p3:meeting:bounced:Bad address"]
  );
  assert.deepEqual(
    observedCommunicationDeliveryFacts("communication-02", [
      failures,
      {
        ...attendance,
        input: { rsvp: ["confirmed"], result: { mode: "list" } },
      },
    ]).facts,
    {}
  );
  assert.deepEqual(
    observedCommunicationDeliveryFacts("communication-02", [failures]).facts,
    {}
  );
});
test("history requires actual person resolution and sent-time window, not created-time or one-person lookup", () => {
  const people = read(
    "people.query",
    { result: { mode: "list" } },
    [item("alex", {}, "Alex Morgan"), item("jordan", {}, "Jordan Lee")],
    2,
    [{ label: "Next page cursor", value: "End of results" }]
  );
  const query = {
    resource: "messages",
    personIds: ["jordan", "alex"],
    timeField: "sent",
    window: communicationDeliveryWindow,
  };
  const messages = read("communication.query", { query }, [
    item("shared"),
    item("alex-only"),
  ]);
  assert.deepEqual(
    observedCommunicationDeliveryFacts("communication-03", [people, messages])
      .facts.messageIds,
    ["alex-only", "shared"]
  );
  for (const bad of [
    { ...query, timeField: "created" },
    { ...query, personIds: ["alex"] },
    {
      ...query,
      window: {
        from: "2026-09-01T00:00:00Z",
        until: communicationDeliveryWindow.until,
      },
    },
  ])
    assert.deepEqual(
      observedCommunicationDeliveryFacts("communication-03", [
        people,
        { ...messages, input: { query: bad } },
      ]).facts,
      {}
    );
});
test("template evidence requires searched identity plus full body and preserves raw merge tokens", () => {
  const search = read(
    "communication.query",
    { query: { resource: "templates", search: "orientation" } },
    [item("template", {}, "Orientation invitation")]
  );
  const details = read(
    "communication.get_many",
    { resource: "templates", ids: ["template"] },
    [
      item("template", {
        Subject: "Hello {{first_name}}",
        "Message template": "Join {{pastor_name}}.",
        Placeholders: '["first_name","pastor_name"]',
      }),
    ]
  );
  for (const id of ["communication-04", "regression-template-placeholders"]) {
    assert.deepEqual(
      observedCommunicationDeliveryFacts(id, [search, details]).facts,
      {
        templateIds: ["template"],
        subject: "Hello {{first_name}}",
        body: "Join {{pastor_name}}.",
        placeholders: ["first_name", "pastor_name"],
      }
    );
    assert.deepEqual(
      observedCommunicationDeliveryFacts(id, [search]).facts,
      {}
    );
    assert.deepEqual(
      observedCommunicationDeliveryFacts(id, [details]).facts,
      {}
    );
    assert.deepEqual(
      observedCommunicationDeliveryFacts(id, [
        search,
        details,
        { ...details, output: { status: "unavailable" } },
      ]).facts,
      {}
    );
  }
});
