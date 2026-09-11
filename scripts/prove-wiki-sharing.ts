/** Run only against a task-owned local scratch DB after applying the wiki DDL.
 * DATABASE_URL=postgres://postgres:postgres@localhost/issue62 \
 * NEON_HTTP_PROXY_URL=http://127.0.0.1:4462/sql pnpm exec tsx scripts/prove-wiki-sharing.ts
 * This proves actual reads/writes, not a browser or numbered-migration pass.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { neonConfig } from "@neondatabase/serverless";
import { eq, inArray } from "drizzle-orm";

async function main() {
  const target = new URL(process.env.DATABASE_URL ?? "");
  const proxy = new URL(process.env.NEON_HTTP_PROXY_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname));
  assert.match(target.pathname, /^\/issue62(?:_[a-z0-9_]+)?$/);
  assert.ok(["localhost", "127.0.0.1"].includes(proxy.hostname));
  neonConfig.fetchEndpoint = proxy.href;
  neonConfig.useSecureWebSocket = false;
  const { db } = await import("../src/db");
  const {
    churches,
    churchPrivacySettings,
    sendingNetworks,
    sendingChurches,
    users,
    wikiArticles,
    wikiProgress,
  } = await import("../src/db/schema");
  const { canAccessFeatureData, privacyColumnFor } =
    await import("../src/lib/auth/access");
  const { holdsSeatFor } = await import("../src/lib/auth/seat-rules");
  const { allSharingOn } = await import("../src/lib/privacy/sharing-defaults");
  const { setSharingToggle } =
    await import("../src/lib/notifications/oversight-sharing");
  const { getOversightPlantDetail } = await import("../src/lib/oversight/read");
  const { readWikiProgressAggregate } =
    await import("../src/lib/oversight/wiki-progress");
  const prefix = `issue62-${randomUUID()}`;
  const networkIds = [randomUUID(), randomUUID()];
  const sendingId = randomUUID();
  const plantIds = [randomUUID(), randomUUID()];
  const userIds = Array.from({ length: 8 }, () => randomUUID());
  const slug = (name: string) => `${prefix}/${name}`;
  try {
    await db
      .insert(sendingNetworks)
      .values(networkIds.map((id) => ({ id, name: prefix })));
    await db.insert(sendingChurches).values({ id: sendingId, name: prefix });
    await db.insert(churches).values(
      plantIds.map((id, index) => ({
        id,
        name: prefix,
        sendingNetworkId: networkIds[index],
        sendingChurchId: index === 0 ? sendingId : null,
        onboardingCompletedAt: new Date(),
      }))
    );
    const accounts = await db
      .insert(users)
      .values(
        [
          { id: userIds[0], seat: "owner" as const, churchId: plantIds[0] },
          { id: userIds[1], seat: "member" as const, churchId: plantIds[0] },
          { id: userIds[2], seat: "member" as const, churchId: plantIds[1] },
          { id: userIds[3], seat: null, churchId: plantIds[0] },
          {
            id: userIds[4],
            seat: "member" as const,
            churchId: plantIds[0],
            sendingNetworkId: networkIds[0],
          },
          {
            id: userIds[5],
            seat: "member" as const,
            sendingNetworkId: networkIds[0],
          },
          {
            id: userIds[6],
            seat: "member" as const,
            sendingNetworkId: networkIds[1],
          },
          {
            id: userIds[7],
            seat: "member" as const,
            sendingChurchId: sendingId,
          },
        ].map((row) => ({
          ...row,
          name: prefix,
          email: `${row.id}@example.invalid`,
          passwordHash: "unused",
        }))
      )
      .returning();
    const account = (id: string) => {
      const row = accounts.find((candidate) => candidate.id === id);
      assert.ok(row);
      return row;
    };
    const owner = account(userIds[0]);
    const network = account(userIds[5]);
    assert.equal(privacyColumnFor("wiki"), "shareWiki");
    assert.equal(allSharingOn().shareWiki, true);
    assert.equal(holdsSeatFor(owner, "sharing.toggle"), true);
    assert.equal(
      holdsSeatFor({ ...owner, seat: "admin" }, "sharing.toggle"),
      false
    );
    assert.equal(holdsSeatFor(account(userIds[1]), "sharing.toggle"), false);
    assert.equal(
      await canAccessFeatureData(network, plantIds[0], "wiki"),
      false
    );
    assert.equal(
      (await getOversightPlantDetail(network, plantIds[0]))?.sections.find(
        (s) => s.key === "wiki"
      )?.state,
      "withheld"
    );
    await db.insert(churchPrivacySettings).values({ churchId: plantIds[0] });
    assert.equal(
      await canAccessFeatureData(network, plantIds[0], "wiki"),
      false
    );
    for (const enabled of [true, false, true]) {
      await setSharingToggle({
        churchId: plantIds[0],
        feature: "wiki",
        enabled,
        updatedBy: owner.id,
      });
      assert.equal(
        await canAccessFeatureData(network, plantIds[0], "wiki"),
        enabled
      );
      assert.equal(
        await canAccessFeatureData(owner, plantIds[0], "wiki"),
        true
      );
      assert.equal(
        await canAccessFeatureData(account(userIds[1]), plantIds[0], "wiki"),
        true
      );
    }
    console.log(
      "PASS: defaults, canonical mapping, owner/member/admin authority, persisted toggle and own-plant access"
    );
    await db.insert(wikiArticles).values(
      [
        { slug: slug("global"), churchId: null, status: "published" as const },
        {
          slug: slug("global"),
          churchId: plantIds[0],
          status: "published" as const,
        },
        {
          slug: slug("local"),
          churchId: plantIds[0],
          status: "published" as const,
        },
        {
          slug: slug("foreign"),
          churchId: plantIds[1],
          status: "published" as const,
        },
        { slug: slug("draft"), churchId: null, status: "draft" as const },
        { slug: slug("archived"), churchId: null, status: "archived" as const },
      ].map((row) => ({
        ...row,
        title: prefix,
        content: "Test",
        contentType: "guide" as const,
      }))
    );
    await db.insert(wikiProgress).values([
      ...userIds.slice(0, 5).map((userId) => ({
        userId,
        articleSlug: slug("global"),
        status: "completed" as const,
      })),
      {
        userId: owner.id,
        articleSlug: slug("local"),
        status: "in_progress" as const,
      },
      ...["foreign", "draft", "archived", "deleted"].map((name) => ({
        userId: owner.id,
        articleSlug: slug(name),
        status: "completed" as const,
      })),
    ]);
    assert.deepEqual(await readWikiProgressAggregate(plantIds[0]), {
      completed: 2,
      inProgress: 1,
    });
    await db
      .update(users)
      .set({ churchId: plantIds[1] })
      .where(eq(users.id, userIds[1]));
    assert.deepEqual(await readWikiProgressAggregate(plantIds[0]), {
      completed: 1,
      inProgress: 1,
    });
    console.log(
      "PASS: counts exclude foreign, departed, seatless, ambiguous accounts and unavailable articles; overrides do not duplicate"
    );
    for (const viewer of [network, account(userIds[7])]) {
      const detail = await getOversightPlantDetail(viewer, plantIds[0]);
      const wiki = detail?.sections.find((s) => s.key === "wiki");
      assert.deepEqual(wiki, {
        key: "wiki",
        state: "shared",
        stats: [
          { label: "Article completions", value: "1" },
          { label: "Readings in progress", value: "1" },
        ],
        isEmpty: false,
      });
    }
    for (const id of [plantIds[0], randomUUID(), "invalid-id"]) {
      assert.equal(
        await getOversightPlantDetail(account(userIds[6]), id),
        null
      );
    }
    await setSharingToggle({
      churchId: plantIds[0],
      feature: "wiki",
      enabled: false,
      updatedBy: owner.id,
    });
    assert.deepEqual(
      (await getOversightPlantDetail(network, plantIds[0]))?.sections.find(
        (s) => s.key === "wiki"
      ),
      { key: "wiki", state: "withheld" }
    );
    const [privacy] = await db
      .select()
      .from(churchPrivacySettings)
      .where(eq(churchPrivacySettings.churchId, plantIds[0]));
    for (const [key, value] of Object.entries(privacy))
      if (key.startsWith("share")) assert.equal(value, false, key);
    console.log(
      "PASS: associated network/sending-church read counts only, foreign/unknown ids refused, disable removes all stats; other toggles unchanged"
    );
  } finally {
    await db.delete(wikiProgress).where(inArray(wikiProgress.userId, userIds));
    await db
      .delete(wikiArticles)
      .where(
        inArray(
          wikiArticles.slug,
          ["global", "local", "foreign", "draft", "archived"].map(slug)
        )
      );
    await db
      .delete(churchPrivacySettings)
      .where(inArray(churchPrivacySettings.churchId, plantIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(churches).where(inArray(churches.id, plantIds));
    await db.delete(sendingChurches).where(eq(sendingChurches.id, sendingId));
    await db
      .delete(sendingNetworks)
      .where(inArray(sendingNetworks.id, networkIds));
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
