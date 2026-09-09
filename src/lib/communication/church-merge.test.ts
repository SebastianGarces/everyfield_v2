import assert from "node:assert/strict";
import test from "node:test";
import { toRichTextHtml, richTextToPlainText } from "@/lib/rich-text/format";
import { churchMergeFactsQuery } from "./church-merge";
import {
  buildResolvedChurchMergeData,
  freezeChurchMergeFields,
  buildPersonMergeData,
  buildChurchMergeData,
  renderSubject,
  renderEmailBodyHtml,
  renderEmailBodyText,
} from "./merge";

const plant = {
  name: "828 Test Church",
  ownerName: "Alex <Smith>",
  leadershipStatus: "planter_confirmed" as const,
  targetDate: "2026-09-13",
};

test("canonical plant facts populate subject, HTML and text without trusting name markup", () => {
  const data = buildResolvedChurchMergeData(plant);
  assert.equal(
    renderSubject("{{pastor_name}} | {{launch_date}}", data),
    "Alex <Smith> | September 13, 2026"
  );
  const body = "<p>{{pastor_name}}</p><p>{{launch_date}}</p>";
  assert.equal(
    renderEmailBodyHtml(body, data),
    "<p>Alex &lt;Smith&gt;</p><p>September 13, 2026</p>"
  );
  assert.equal(
    renderEmailBodyText(richTextToPlainText(body), data),
    "Alex <Smith>\n\nSeptember 13, 2026"
  );
});

test("no planter and missing launch drop optional lines without sample facts", () => {
  const data = buildResolvedChurchMergeData({
    ...plant,
    leadershipStatus: "no_planter",
    targetDate: null,
  });
  assert.equal(data.pastor_name, "");
  assert.equal(data.launch_date, "");
  assert.equal(
    renderEmailBodyHtml(
      "<p>Hello</p><p>{{pastor_name}}</p><p>{{launch_date}}</p>",
      data
    ),
    "<p>Hello</p>"
  );
});

test("legacy unanswered leadership retains its Owner; absent or blank Owner names stay empty", () => {
  assert.equal(
    buildResolvedChurchMergeData({ ...plant, leadershipStatus: null })
      .pastor_name,
    plant.ownerName
  );
  for (const ownerName of [null, "", "   "]) {
    assert.equal(
      buildResolvedChurchMergeData({ ...plant, ownerName }).pastor_name,
      ""
    );
  }
});

test("calendar launch day is stable across runtime zones and DST dates", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"]) {
      process.env.TZ = zone;
      assert.equal(
        buildResolvedChurchMergeData(plant).launch_date,
        "September 13, 2026"
      );
      assert.equal(
        buildResolvedChurchMergeData({ ...plant, targetDate: "2026-03-08" })
          .launch_date,
        "March 8, 2026"
      );
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("church and Owner join are tenant-scoped and exclude oversight owners", () => {
  const query = churchMergeFactsQuery("828-church-a").toSQL();
  assert.match(query.sql, /"users"\."church_id" = "churches"\."id"/);
  assert.match(query.sql, /"users"\."sending_church_id" is null/);
  assert.match(query.sql, /"users"\."sending_network_id" is null/);
  assert.match(query.sql, /where "churches"\."id" = \$/);
  assert.deepEqual(query.params, ["owner", "828-church-a", 1]);
});

test("legacy name-only builder retains the excluded Evri contract", () => {
  assert.deepEqual(buildChurchMergeData({ name: plant.name }), {
    church_name: plant.name,
    pastor_name: "",
    launch_date: "",
  });
});

test("stored plant facts survive a leadership/date change and preserve recipient tokens", () => {
  const churchData = buildResolvedChurchMergeData(plant);
  const template = {
    subject: "{{pastor_name}} invites {{first_name}} on {{launch_date}}",
    bodyHtml:
      "<p>{{first_name}}</p><p>{{pastor_name}}</p><p>{{launch_date}}</p>",
  };
  const stored = freezeChurchMergeFields(template, churchData);
  assert.equal(
    stored.subject,
    "Alex <Smith> invites {{first_name}} on September 13, 2026"
  );
  const recipient = buildPersonMergeData({
    firstName: "Jo",
    lastName: "Test",
    email: null,
  });
  // Shared history still uses its legacy church builder, as do Evri messages.
  const historyData = {
    ...buildChurchMergeData({ name: plant.name }),
    ...recipient,
  };
  assert.equal(
    renderSubject(stored.subject, historyData),
    renderSubject(template.subject, { ...churchData, ...recipient })
  );
  assert.equal(
    renderEmailBodyHtml(stored.bodyHtml, historyData),
    renderEmailBodyHtml(template.bodyHtml, { ...churchData, ...recipient })
  );
  const changedPlant = buildResolvedChurchMergeData({
    ...plant,
    ownerName: "New Pastor",
    targetDate: "2027-01-03",
  });
  assert.equal(
    renderSubject(stored.subject, { ...changedPlant, ...recipient }),
    "Alex <Smith> invites Jo on September 13, 2026"
  );
});

test("only referenced values with delimiter syntax refuse freezing", () => {
  const data = buildResolvedChurchMergeData({
    ...plant,
    ownerName: "Pastor {{first_name}}",
  });
  assert.throws(
    () =>
      freezeChurchMergeFields(
        { subject: "{{pastor_name}}", bodyHtml: "<p>Hello</p>" },
        data
      ),
    /Cannot send with plant merge fields/
  );
  assert.doesNotThrow(() =>
    freezeChurchMergeFields(
      { subject: "Hello {{first_name}}", bodyHtml: "<p>{{launch_date}}</p>" },
      data
    )
  );
  assert.throws(
    () =>
      freezeChurchMergeFields(
        { subject: "{{pastor_name}}", bodyHtml: "<p>Hello</p>" },
        { ...data, pastor_name: "Pastor {{not_a_merge_field}}" }
      ),
    /Cannot send with plant merge fields/
  );
});

for (const [ownerName, text] of [
  ["{{first_", "From {{pastor_name}}name}}"],
  ["name}}", "From {{first_{{pastor_name}}"],
  ["{", "From {{{pastor_name}}first_name}}"],
  ["}", "From {{first_name}{{pastor_name}}"],
  ["first_name", "From {{{{pastor_name}}}}"],
  ["", "From {{first_{{pastor_name}}name}}"],
]) {
  test(`refuse token assembly from ${JSON.stringify(ownerName)} in subject and body`, () => {
    const data = buildResolvedChurchMergeData({ ...plant, ownerName });
    for (const template of [
      { subject: text, bodyHtml: "<p>Hello</p>" },
      { subject: "Hello", bodyHtml: `<p>${text}</p>` },
    ]) {
      assert.throws(
        () => freezeChurchMergeFields(template, data),
        /Cannot send with plant merge fields/
      );
    }
  });
}

test("a dropped link cannot authorize a new token assembled in another link", () => {
  const bodyHtml = toRichTextHtml(
    '<p><a href="https://example.invalid/{{first_name}}">{{pastor_name}}</a></p>' +
      '<p><a href="https://example.invalid/{{first_{{pastor_name}}name}}">Click</a></p>'
  );
  assert.match(
    bodyHtml,
    /href="https:\/\/example.invalid\/\{\{first_name\}\}"/
  );
  assert.throws(
    () =>
      freezeChurchMergeFields(
        { subject: "Hello", bodyHtml },
        buildResolvedChurchMergeData({ ...plant, ownerName: "" })
      ),
    /Cannot send with plant merge fields/
  );
});

test("valid adjacent tokens and unrelated literal braces remain accepted", () => {
  const stored = freezeChurchMergeFields(
    {
      subject: "{News} {{pastor_name}}{{first_name}}",
      bodyHtml: toRichTextHtml(
        '<p>{News}</p><p>{{pastor_name}}{{first_name}}</p><p><a href="https://example.invalid/{{first_name}}">Click</a></p>'
      ),
    },
    buildResolvedChurchMergeData(plant)
  );
  assert.equal(stored.subject, "{News} Alex <Smith>{{first_name}}");
  assert.match(
    stored.bodyHtml,
    /href="https:\/\/example.invalid\/\{\{first_name\}\}"/
  );
});

for (const [ownerName, html] of [
  [
    "name",
    "{{first_<p>{{launch_date}}</p>{{pastor_name}}<p>{{launch_date}}</p>}}",
  ],
  ["", "{{first_<p>{{pastor_name}}</p>name}}"],
  ["", "{<p>{{pastor_name}}</p>{first_name}<p>{{launch_date}}</p>}"],
]) {
  test(`empty cleanup cannot assemble a token from ${JSON.stringify(html)}`, () => {
    assert.throws(
      () =>
        freezeChurchMergeFields(
          { subject: "Hello", bodyHtml: toRichTextHtml(html) },
          buildResolvedChurchMergeData({
            ...plant,
            ownerName,
            targetDate: null,
          })
        ),
      /Cannot send with plant merge fields/
    );
  });
}

test("unrelated sends do not gain new template validation", () => {
  const template = {
    subject: "Hello",
    bodyHtml: toRichTextHtml("<p>{{first_<em>name</em>}}</p>"),
  };
  assert.doesNotThrow(() =>
    freezeChurchMergeFields(
      template,
      buildResolvedChurchMergeData({ ...plant, ownerName: "{{first_" })
    )
  );
});
