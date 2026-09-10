import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { before, describe, test } from "node:test";

import { neon, neonConfig } from "@neondatabase/serverless";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { churches } from "../../db/schema/church";
import { discoveryProfiles } from "../../db/schema/discovery-profile";
import { sendingChurches } from "../../db/schema/sending-church";
import { sendingNetworks } from "../../db/schema/sending-network";
import { users } from "../../db/schema/user";
import {
  createDiscoveryProfileStatement,
  lockDiscoveryAccountStatement,
  readDiscoveryProfileStatement,
  retireEmptyDiscoveryProfileStatement,
} from "./profile-repository";

// Deliberately outside the shared live suite registry. The task-owned runner
// creates and destroys a fresh stack and supplies only its connection details.
const enabled = process.env.DISCOVERY_PROFILE_PROOF === "1";

describe(
  "persisted discovery profiles on disposable Postgres",
  { skip: !enabled },
  () => {
    if (!enabled) return;
    const connection = process.env.DISCOVERY_PROFILE_DATABASE_URL;
    const endpoint = process.env.DISCOVERY_PROFILE_ENDPOINT;
    const container = process.env.DISCOVERY_PROFILE_PG;
    if (!connection || !endpoint || !container) {
      throw new Error("Run node scripts/prove-discovery-profile.mjs");
    }
    const postgresContainer: string = container;
    const url = new URL(connection);
    assert.equal(url.hostname, "localhost");
    assert.equal(url.pathname, "/discovery_294_proof");
    assert.equal(new URL(endpoint).hostname, "127.0.0.1");
    assert.match(container, /^discovery-294-[a-f0-9]{8}-pg$/);
    neonConfig.fetchEndpoint = endpoint;
    const db = drizzle(neon(connection));

    before(async () => {
      const baseline = { users, churches, sendingChurches, sendingNetworks };
      // Serialize the actual table declarations, without allocating a migration
      // or creating any journal/snapshot files. This is scratch setup only.
      const prior = generateDrizzleJson(baseline);
      for (const statement of await generateMigration(
        generateDrizzleJson({}),
        prior
      )) {
        await db.execute(sql.raw(statement));
      }
      const delta = await generateMigration(
        prior,
        generateDrizzleJson({ ...baseline, discoveryProfiles })
      );
      console.log("Scratch discovery-profile DDL from the actual schema:");
      for (const statement of delta) {
        console.log(statement);
        await db.execute(sql.raw(statement));
      }
    });

    async function account() {
      const id = randomUUID();
      await db.insert(users).values({
        id,
        email: `${id}@example.test`,
        passwordHash: "proof-only",
      });
      return { id };
    }

    async function mutate(actor: { id: string }, statement: SQL) {
      const [, result] = await db.batch([
        db.execute(lockDiscoveryAccountStatement(actor)),
        db.execute<{ userId: string }>(statement),
      ]);
      return result.rows;
    }

    async function profile(actor: { id: string }) {
      return (await db.execute(readDiscoveryProfileStatement(actor))).rows;
    }

    function sqlState(code: string) {
      return (error: unknown) => {
        let current = error;
        while (current !== null && typeof current === "object") {
          if ("code" in current && current.code === code) return true;
          current = "cause" in current ? current.cause : null;
        }
        return false;
      };
    }

    test("creation persists, is actor-scoped and replay has no winner", async () => {
      const actor = await account();
      const foreign = await account();
      assert.deepEqual(
        await mutate(actor, createDiscoveryProfileStatement(actor)),
        [{ userId: actor.id }]
      );
      assert.deepEqual(
        await mutate(actor, createDiscoveryProfileStatement(actor)),
        []
      );
      assert.deepEqual(await profile(actor), [
        { userId: actor.id, sendingChurchId: null, sendingNetworkId: null },
      ]);
      assert.deepEqual(await profile(foreign), []);
      assert.deepEqual(
        await mutate(foreign, retireEmptyDiscoveryProfileStatement(foreign)),
        []
      );
      assert.equal((await profile(actor)).length, 1);
      const missing = { id: randomUUID() };
      assert.deepEqual(
        await mutate(missing, createDiscoveryProfileStatement(missing)),
        []
      );
    });

    test("fresh standing refuses both creation and retirement, including defective multi-tenancy", async () => {
      const [plant] = await db
        .insert(churches)
        .values({ name: "294 proof plant", onboardingCompletedAt: new Date() })
        .returning();
      const [org] = await db
        .insert(sendingChurches)
        .values({ name: "294 proof sender" })
        .returning();
      const [network] = await db
        .insert(sendingNetworks)
        .values({ name: "294 proof network" })
        .returning();
      for (const standing of [
        { seat: "owner" },
        { seat: "admin" },
        { seat: "member" },
        { churchId: plant.id },
        { sendingChurchId: org.id },
        { sendingNetworkId: network.id },
        { churchId: plant.id, sendingNetworkId: network.id },
      ] as const) {
        const actor = await account();
        await mutate(actor, createDiscoveryProfileStatement(actor));
        await db
          .update(users)
          .set(standing)
          .where(sql`${users.id} = ${actor.id}`);
        assert.deepEqual(
          await mutate(actor, createDiscoveryProfileStatement(actor)),
          []
        );
        assert.deepEqual(
          await mutate(actor, retireEmptyDiscoveryProfileStatement(actor)),
          []
        );
        assert.deepEqual(await profile(actor), []);
        const stored = await db
          .select()
          .from(discoveryProfiles)
          .where(sql`${discoveryProfiles.userId} = ${actor.id}`);
        assert.equal(
          stored.length,
          1,
          "stale profile must not be retired by an ineligible account"
        );
        await db
          .delete(discoveryProfiles)
          .where(sql`${discoveryProfiles.userId} = ${actor.id}`);
        assert.deepEqual(
          await mutate(actor, createDiscoveryProfileStatement(actor)),
          [],
          "standing check must refuse an absent profile too"
        );
      }
    });

    test("database enforces profile identity and both association foreign keys", async () => {
      const actor = await account();
      await mutate(actor, createDiscoveryProfileStatement(actor));
      await assert.rejects(
        db.insert(discoveryProfiles).values({ userId: actor.id }),
        sqlState("23505")
      );
      await assert.rejects(
        db.insert(discoveryProfiles).values({ userId: randomUUID() }),
        sqlState("23503")
      );
      for (const bad of [
        { sendingChurchId: randomUUID() },
        { sendingNetworkId: randomUUID() },
      ]) {
        await assert.rejects(
          db
            .update(discoveryProfiles)
            .set(bad)
            .where(sql`${discoveryProfiles.userId} = ${actor.id}`),
          sqlState("23503")
        );
      }
      assert.deepEqual(await profile(actor), [
        { userId: actor.id, sendingChurchId: null, sendingNetworkId: null },
      ]);
    });

    test("either association blocks retirement; only the empty profile returns a winner", async () => {
      const [org] = await db
        .insert(sendingChurches)
        .values({ name: "294 associations sender" })
        .returning();
      const [network] = await db
        .insert(sendingNetworks)
        .values({ name: "294 associations network" })
        .returning();
      for (const associations of [
        { sendingChurchId: org.id, sendingNetworkId: null },
        { sendingChurchId: null, sendingNetworkId: network.id },
        { sendingChurchId: org.id, sendingNetworkId: network.id },
      ]) {
        const actor = await account();
        await mutate(actor, createDiscoveryProfileStatement(actor));
        await db
          .update(discoveryProfiles)
          .set(associations)
          .where(sql`${discoveryProfiles.userId} = ${actor.id}`);
        assert.deepEqual(
          await mutate(actor, retireEmptyDiscoveryProfileStatement(actor)),
          []
        );
        assert.deepEqual(await profile(actor), [
          { userId: actor.id, ...associations },
        ]);
        await db
          .update(discoveryProfiles)
          .set({ sendingChurchId: null, sendingNetworkId: null })
          .where(sql`${discoveryProfiles.userId} = ${actor.id}`);
        assert.deepEqual(
          await mutate(actor, retireEmptyDiscoveryProfileStatement(actor)),
          [{ userId: actor.id }]
        );
        assert.deepEqual(
          await mutate(actor, retireEmptyDiscoveryProfileStatement(actor)),
          []
        );
        assert.deepEqual(await profile(actor), []);
      }
    });

    test("create and retirement roll back if a later batched statement fails", async () => {
      const actor = await account();
      await assert.rejects(
        db.batch([
          db.execute(lockDiscoveryAccountStatement(actor)),
          db.execute(createDiscoveryProfileStatement(actor)),
          db.execute(sql`select 1/0`),
        ])
      );
      assert.deepEqual(await profile(actor), []);
      await mutate(actor, createDiscoveryProfileStatement(actor));
      await assert.rejects(
        db.batch([
          db.execute(lockDiscoveryAccountStatement(actor)),
          db.execute(retireEmptyDiscoveryProfileStatement(actor)),
          db.execute(sql`select 1/0`),
        ])
      );
      assert.equal((await profile(actor)).length, 1);
    });

    test("concurrent create and retirement each have exactly one winning row", async () => {
      const actor = await account();
      const creates = await Promise.all(
        Array.from({ length: 4 }, () =>
          mutate(actor, createDiscoveryProfileStatement(actor))
        )
      );
      assert.equal(creates.flat().length, 1);
      const retirements = await Promise.all(
        Array.from({ length: 4 }, () =>
          mutate(actor, retireEmptyDiscoveryProfileStatement(actor))
        )
      );
      assert.equal(retirements.flat().length, 1);
      assert.deepEqual(await profile(actor), []);
    });

    test("a dependent CTE effect is written only from the retirement winner", async () => {
      await db.execute(
        sql`create table discovery_retirement_proof_effects (user_id uuid primary key)`
      );
      const actor = await account();
      const [network] = await db
        .insert(sendingNetworks)
        .values({ name: "294 CTE proof network" })
        .returning();
      const effect = sql`with retired as (${retireEmptyDiscoveryProfileStatement(actor)})
        insert into discovery_retirement_proof_effects (user_id)
        select "userId" from retired returning user_id as "userId"`;
      assert.deepEqual(
        await mutate(actor, effect),
        [],
        "no profile is not a retirement winner"
      );
      await mutate(actor, createDiscoveryProfileStatement(actor));
      await db
        .update(discoveryProfiles)
        .set({ sendingNetworkId: network.id })
        .where(sql`${discoveryProfiles.userId} = ${actor.id}`);
      assert.deepEqual(
        await mutate(actor, effect),
        [],
        "an associated profile cannot drive an effect"
      );
      await db
        .update(discoveryProfiles)
        .set({ sendingNetworkId: null })
        .where(sql`${discoveryProfiles.userId} = ${actor.id}`);
      await assert.rejects(
        db.batch([
          db.execute(lockDiscoveryAccountStatement(actor)),
          db.execute(effect),
          db.execute(sql`select 1/0`),
        ]),
        sqlState("22012")
      );
      assert.equal((await profile(actor)).length, 1);
      assert.deepEqual(
        (
          await db.execute(
            sql`select * from discovery_retirement_proof_effects`
          )
        ).rows,
        []
      );
      assert.deepEqual(await mutate(actor, effect), [{ userId: actor.id }]);
      assert.deepEqual(await mutate(actor, effect), []);
      assert.deepEqual(
        (
          await db.execute(
            sql`select user_id as "userId" from discovery_retirement_proof_effects`
          )
        ).rows,
        [{ userId: actor.id }]
      );
    });

    // A separate psql session holds an uncommitted change. The contender must
    // actually appear in pg_blocking_pids before we commit, not merely run near it.
    async function behindConcurrentChange(
      actor: { id: string },
      change: string,
      statement: SQL
    ) {
      const holder = spawn(
        "docker",
        [
          "exec",
          "-i",
          postgresContainer,
          "psql",
          "-X",
          "-qAt",
          "-U",
          "postgres",
          "-d",
          "discovery_294_proof",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] }
      );
      const closed = once(holder, "close");
      let output = "";
      let errors = "";
      holder.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      holder.stderr.on("data", (chunk) => {
        errors += chunk.toString();
      });
      holder.stdin.write(
        `begin; select id from users where id='${actor.id}' for update; ${change};\n\\echo locked\n`
      );
      const waitUntil = async (predicate: () => boolean | Promise<boolean>) => {
        const deadline = Date.now() + 8_000;
        while (!(await predicate())) {
          if (Date.now() > deadline)
            throw new Error(`Barrier timeout: ${errors}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      let contender: Promise<{ userId: string }[]> | undefined;
      try {
        await waitUntil(() => output.includes("locked"));
        contender = mutate(actor, statement);
        // Attach rejection handling immediately; rethrow after releasing the lock.
        void contender.catch(() => {});
        await waitUntil(async () => {
          const result = await db.execute<{
            blocked: boolean;
          }>(sql`select exists (
          select 1 from pg_stat_activity
          where cardinality(pg_blocking_pids(pid)) > 0
            and query ilike '%for update%'
        ) as blocked`);
          return result.rows[0].blocked;
        });
        holder.stdin.end("commit;\n");
        const [code] = await closed;
        assert.equal(code, 0, errors);
        return await contender;
      } finally {
        if (!holder.stdin.writableEnded) holder.stdin.end("rollback;\n");
        await closed;
        await contender?.catch(() => {});
      }
    }

    test("create rechecks standing after waiting for the account lock", async () => {
      const actor = await account();
      const rows = await behindConcurrentChange(
        actor,
        `update users set seat='member' where id='${actor.id}'`,
        createDiscoveryProfileStatement(actor)
      );
      assert.deepEqual(rows, []);
      assert.deepEqual(
        await db
          .select()
          .from(discoveryProfiles)
          .where(sql`${discoveryProfiles.userId} = ${actor.id}`),
        []
      );
    });

    test("retirement rechecks new standing and both associations after lock contention", async () => {
      const [org] = await db
        .insert(sendingChurches)
        .values({ name: "294 race sender" })
        .returning();
      const [network] = await db
        .insert(sendingNetworks)
        .values({ name: "294 race network" })
        .returning();
      for (const field of [
        "seat",
        "sending_church_id",
        "sending_network_id",
      ] as const) {
        const actor = await account();
        await mutate(actor, createDiscoveryProfileStatement(actor));
        const change =
          field === "seat"
            ? `update users set seat='member' where id='${actor.id}'`
            : `update discovery_profiles set ${field}='${field === "sending_church_id" ? org.id : network.id}' where user_id='${actor.id}'`;
        assert.deepEqual(
          await behindConcurrentChange(
            actor,
            change,
            retireEmptyDiscoveryProfileStatement(actor)
          ),
          []
        );
        assert.equal(
          (
            await db
              .select()
              .from(discoveryProfiles)
              .where(sql`${discoveryProfiles.userId} = ${actor.id}`)
          ).length,
          1
        );
      }
    });
  }
);
