import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixtureManifest } from "./manifest";
import { createFixtureStore } from "./store";
import { startFixtureStack } from "./stack";

test(
  "isolated audit captures actor-owned bookmark writes including both update owners and reverted changes",
  {
    skip: process.env.EVRY_EVE_STORE_AUDIT_PROOF !== "1",
    timeout: 120_000,
  },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    try {
      const store = createFixtureStore(stack.container);
      const m = createFixtureManifest("store-audit", 0);
      store.seed(m);
      const i = m.ids;
      const check = (
        statement: string,
        expected: { table_name: string; operation: string; church_id: string }[]
      ) => {
        const start = store.auditStart();
        store.sql(statement);
        assert.deepEqual(
          store
            .writesSince(start, m)
            .sort((a, b) =>
              String(a.church_id).localeCompare(String(b.church_id))
            ),
          expected.sort((a, b) => a.church_id.localeCompare(b.church_id))
        );
      };
      const bookmark = (operation: string, church_id = i.plant) => ({
        table_name: "wiki_bookmarks",
        operation,
        church_id,
      });
      check(
        `insert into wiki_bookmarks(user_id,article_slug) values ('${i.actor}','audit-bookmark')`,
        [bookmark("INSERT")]
      );
      check(
        `update wiki_bookmarks set user_id='${i["other-actor"]}' where user_id='${i.actor}' and article_slug='audit-bookmark'`,
        [bookmark("UPDATE")]
      );
      check(
        `update wiki_bookmarks set user_id='${i["foreign-actor"]}' where user_id='${i["other-actor"]}' and article_slug='audit-bookmark'`,
        [bookmark("UPDATE"), bookmark("UPDATE", i["foreign-plant"])]
      );
      check(
        `delete from wiki_bookmarks where user_id='${i["foreign-actor"]}' and article_slug='audit-bookmark'`,
        [bookmark("DELETE", i["foreign-plant"])]
      );
      check(
        `insert into wiki_bookmarks(user_id,article_slug) values ('${i["foreign-actor"]}','foreign-bookmark')`,
        [bookmark("INSERT", i["foreign-plant"])]
      );
      const before = store.query(
        "select user_id,article_slug from wiki_bookmarks order by user_id,article_slug"
      );
      check(
        `begin; insert into wiki_bookmarks(user_id,article_slug) values ('${i.actor}','reverted-bookmark'); delete from wiki_bookmarks where user_id='${i.actor}' and article_slug='reverted-bookmark'; commit;`,
        [bookmark("INSERT"), bookmark("DELETE")]
      );
      assert.deepEqual(
        store.query(
          "select user_id,article_slug from wiki_bookmarks order by user_id,article_slug"
        ),
        before
      );
      check(`update users set name='Audit updated' where id='${i.actor}'`, [
        { table_name: "users", operation: "UPDATE", church_id: i.plant },
      ]);
      check(
        `begin; insert into wiki_bookmarks(user_id,article_slug) values ('${i.actor}','rolled-back-bookmark'); rollback;`,
        []
      );
    } finally {
      await stack.cleanup();
    }
  }
);
