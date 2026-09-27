/** Seeds and proves the Wiki audit against a fresh owned preview database.
 * Keep the private fixture manifest for browser login; tear down the whole stack.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { wikiArticles, wikiProgress, users, type User } from "@/db/schema";
import { searchWikiPage } from "@/lib/wiki/search";
import { parseWikiSearchParams } from "@/lib/wiki/search-params";
import { recordViewUpsertQuery } from "@/lib/wiki/write-queries";
import { UnauthorizedError } from "@/lib/auth/unauthorized";

async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  const connection = new URL(process.env.DATABASE_URL!);
  assert.equal(connection.hostname, "localhost");
  assert.match(connection.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  const fixturePath = process.argv[2];
  const output = process.argv[3];
  assert.ok(fixturePath?.startsWith("/private/tmp/"));
  assert.ok(output?.startsWith("/private/tmp/"));
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const identity = await db.execute<{ name: string }>(
    sql`select current_database() as name`
  );
  assert.equal(identity.rows[0].name, fixture.database);
  assert.equal(connection.pathname, `/${fixture.database}`);
  assert.equal(
    (await db.select().from(wikiArticles)).length,
    0,
    "Run on a fresh owned fixture stack"
  );
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.id, fixture.accounts[0].id));
  let actor: User | null = owner;
  mock.module("@/lib/auth/session", {
    namedExports: {
      verifySession: async () => {
        if (!actor) throw new UnauthorizedError();
        return { user: actor };
      },
      getCurrentSession: async () => ({ user: actor, session: null }),
    },
  });
  // Rendering is proved through Next in the browser. The Node harness does not
  // compile MDX; loading its ESM-only compiler through tsx's CJS graph fails.
  mock.module("next-mdx-remote/rsc", {
    namedExports: {
      compileMDX: () => {
        throw new Error("Unexpected MDX compilation in backend proof");
      },
    },
  });
  mock.module("remark-gfm", {
    defaultExport: () => {
      throw new Error("Unexpected remark compilation");
    },
  });
  mock.module("rehype-slug", {
    defaultExport: () => {
      throw new Error("Unexpected rehype compilation");
    },
  });
  const { searchWikiArticles } = await import("@/app/(dashboard)/wiki/actions");
  const { getLastInProgress } = await import("@/lib/wiki/reads");
  const query = "zephyraudit";
  const baseline = Array.from({ length: 45 }, (_, index) => ({
    slug: `audit/search-${String(index).padStart(2, "0")}`,
    title: `${index % 2 ? "Body match" : "Zephyraudit guidance"} ${index}`,
    content: `## Guidance\n\nZephyraudit is practical planting guidance. Read with your team and use it to plan the next step.`,
    contentType: index % 2 ? ("reference" as const) : ("tutorial" as const),
    phase: index % 3,
    updatedAt: new Date(Date.UTC(2026, 0, index + 1)),
  }));
  await db.insert(wikiArticles).values(baseline);
  const specialSlug = "audit/100% of #what?";
  const longSlug = "audit/long-reading";
  await db.insert(wikiArticles).values([
    {
      slug: specialSlug,
      title: "Zephyraudit special route",
      content: "A safe special-character route with zephyraudit guidance.",
      contentType: "guide",
    },
    {
      slug: "audit/own",
      churchId: fixture.primaryChurchId,
      title: "Zephyraudit plant edition",
      content: "Zephyraudit own plant text",
      contentType: "guide",
    },
    {
      slug: "audit/foreign",
      churchId: fixture.foreignChurchId,
      title: "Zephyraudit foreign secret",
      content: "Zephyraudit hidden foreign snippet",
      contentType: "guide",
    },
    {
      slug: "audit/draft",
      title: "Zephyraudit draft secret",
      content: "Zephyraudit hidden draft snippet",
      status: "draft",
      contentType: "guide",
    },
    {
      slug: "audit/override",
      title: "Zephyraudit overwritten secret",
      content: "Zephyraudit hidden global snippet",
      contentType: "guide",
    },
    {
      slug: "audit/override",
      churchId: fixture.primaryChurchId,
      title: "Plant replacement",
      content: "Different visible guidance",
      contentType: "guide",
    },
    {
      slug: longSlug,
      title: "Long reading fixture",
      content: Array.from(
        { length: 32 },
        (_, i) =>
          `## Reading section ${i + 1}\n\n${"A planter learns with the team, reflects on the guidance and takes the next practical step together. ".repeat(12)}`
      ).join("\n\n"),
      contentType: "guide",
      phase: 1,
    },
    {
      slug: "core-group/commitment/the-three-key-documents",
      title: "The Three Key Documents",
      content:
        "## Commitment\n\nCommitment cards and member expectations support the Core Group. The organizational agreement is a separate document.",
      contentType: "reference",
      phase: 1,
    },
    {
      slug: "launch-team/launch-date/transitioning-to-launch-team",
      title: "Transitioning to Launch Team",
      content:
        "## Launch Team commitment\n\nClarify commitments as the Core Group transitions to the Launch Team.",
      contentType: "guide",
      phase: 2,
    },
  ]);
  const page = (
    input: Record<string, string> = {},
    churchId: string | null = fixture.primaryChurchId
  ) => searchWikiPage(parseWikiSearchParams({ q: query, ...input }), churchId);
  const first = await page();
  const second = await page({ page: "2" });
  const third = await page({ page: "3" });
  assert.deepEqual(
    [
      first.results.length,
      second.results.length,
      third.results.length,
      third.total,
    ],
    [20, 40, 47, 47]
  );
  assert.deepEqual(
    second.results.slice(0, 20).map((r) => r.id),
    first.results.map((r) => r.id)
  );
  assert.equal(new Set(third.results.map((r) => r.id)).size, 47);
  assert.ok(
    third.results.every(
      (row) =>
        !`${row.title} ${row.snippet}`.includes("secret") &&
        !row.snippet.includes("hidden")
    )
  );
  assert.ok(third.results.some((row) => row.slug === specialSlug));
  assert.ok(third.results.some((row) => row.snippet.includes("")));
  const filtered = await page({ phase: "1", type: "reference", page: "3" });
  assert.ok(filtered.results.length > 0);
  assert.equal(
    filtered.total,
    baseline.filter((row) => row.phase === 1 && row.contentType === "reference")
      .length
  );
  assert.ok(
    filtered.results.every(
      (row) => row.phase === 1 && row.contentType === "reference"
    )
  );
  const recent = await page({ sort: "recent", page: "3" });
  assert.notDeepEqual(
    recent.results.map((row) => row.id),
    third.results.map((row) => row.id)
  );
  const global = await page({ page: "3" }, null);
  assert.ok(global.results.some((row) => row.slug === "audit/override"));
  assert.ok(
    !global.results.some(
      (row) => row.slug === "audit/own" || row.slug === "audit/foreign"
    )
  );
  assert.equal((await searchWikiArticles(query)).length, 10);
  assert.deepEqual(await searchWikiArticles(""), []);
  actor = null;
  await assert.rejects(searchWikiArticles(query), UnauthorizedError);
  actor = owner;
  await db.insert(wikiProgress).values([
    {
      userId: owner.id,
      articleSlug: longSlug,
      status: "in_progress",
      scrollPosition: 0.45,
      lastViewedAt: new Date("2026-01-01"),
    },
    {
      userId: owner.id,
      articleSlug: "audit/removed",
      status: "in_progress",
      scrollPosition: 0.9,
      lastViewedAt: new Date("2026-02-01"),
    },
    {
      userId: owner.id,
      articleSlug: "audit/foreign",
      status: "in_progress",
      scrollPosition: 0.8,
      lastViewedAt: new Date("2026-03-01"),
    },
  ]);
  assert.equal((await getLastInProgress())?.slug, longSlug);
  await recordViewUpsertQuery(owner.id, longSlug, new Date());
  const [progress] = await db
    .select()
    .from(wikiProgress)
    .where(eq(wikiProgress.articleSlug, longSlug));
  assert.ok(Math.abs(progress.scrollPosition! - 0.45) < 0.001);
  assert.equal(progress.status, "in_progress");
  writeFileSync(
    output,
    JSON.stringify(
      {
        database: fixture.database,
        ownerId: owner.id,
        query,
        specialSlug,
        longSlug,
        expected: { total: 47, pages: [20, 40, 47], savedPosition: 0.45 },
        passed: [
          "three-page stable search",
          "type/phase count scope",
          "relevance/recency",
          "published tenant visibility and overrides before counts/snippets",
          "quick search retained",
          "anonymous action refusal",
          "unreachable resume targets excluded",
          "record view preserves saved position",
        ],
      },
      null,
      2
    ) + "\n",
    { mode: 0o600 }
  );
  console.log(
    "Wiki query, tenancy, auth and progress proof passed; browser fixtures retained in owned stack."
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
