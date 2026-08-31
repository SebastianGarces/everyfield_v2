import assert from "node:assert/strict";

import {
  customerContentPreviews,
  customerReviewTargets,
  readResultLabel,
} from "../src/components/evry/artifacts/artifact-presentation";

const UUID = "9fdd2965-c4a6-445d-b216-9421e6c50834";
const targets = customerReviewTargets([
  { label: "meetingId", value: UUID, sourceLink: null },
  { label: "expectedMeetingAbsent", value: "true", sourceLink: null },
  { label: "title", value: "Vision Meeting", sourceLink: null },
  { label: "locationName", value: "Church location", sourceLink: null },
  { label: "teamId", value: "null", sourceLink: null },
]);
const previews = customerContentPreviews([
  {
    label: "Meeting notification 1",
    content: JSON.stringify({ notificationId: UUID, body: "Internal payload" }),
  },
  {
    label: "Complete immutable plan",
    content: JSON.stringify({ meetingId: UUID }),
  },
  { label: "Recipient 1 message", content: "Join us for Vision Meeting." },
]);

assert.deepEqual(
  targets.map(({ label, value }) => [label, value]),
  [
    ["title", "Vision Meeting"],
    ["locationName", "Church location"],
  ]
);
assert.deepEqual(
  previews.map(({ label, content }) => [label, content]),
  [["Recipient 1 message", "Join us for Vision Meeting."]]
);
assert.equal(readResultLabel(0), "0 results");

const visible = JSON.stringify({ targets, previews });
assert.equal(visible.includes(UUID), false);
assert.equal(visible.includes("notificationId"), false);
assert.equal(visible.includes("immutable"), false);

console.log("Evry customer UI contract passed.");
