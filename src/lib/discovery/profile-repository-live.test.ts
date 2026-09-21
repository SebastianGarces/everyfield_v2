import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { before, describe, test } from "node:test";

import { neon } from "@neondatabase/serverless";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { churches } from "../../db/schema/church";
import { discoveryProfiles } from "../../db/schema/discovery-profile";
import { sendingChurches } from "../../db/schema/sending-church";
import { sendingNetworks } from "../../db/schema/sending-network";
import { users } from "../../db/schema/user";
import { userInvitations } from "../../db/schema/user-invitation";
import { persons, households } from "../../db/schema/people";
import { organizationInvitations } from "../../db/schema/organization-invitation";
import { associationEvents } from "../../db/schema/association-event";
import { churchPrivacySettings } from "../../db/schema/church-privacy-settings";
import { registerDiscoveryPlantLiveTests } from "./plant-transfer-live-cases";
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
  async () => {
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
    // Transport and application connection are configured by the runner preload.
    assert.equal(process.env.DATABASE_URL, connection);
    const db = drizzle(neon(connection));
    registerDiscoveryPlantLiveTests(db);
    const { registerDiscoveryAssociationLiveTests } =
      await import("./association-live-cases");
    registerDiscoveryAssociationLiveTests(db);

    before(async () => {
      const baseline = {
        users,
        churches,
        sendingChurches,
        sendingNetworks,
        userInvitations,
        persons,
        households,
        organizationInvitations,
        associationEvents,
        churchPrivacySettings,
      };
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

    test("registration atomically creates only a seatless account and discovery profile", async () => {
      const { createAccountEntities } =
        await import("../../app/(auth)/register/account-entities");
      const { registerSchema } = await import("../validations/auth");
      const input = registerSchema.parse({
        accountType: "discovery",
        name: "Explorer",
        email: `${randomUUID()}@example.test`,
        password: "scratch-password",
      });
      for (const rollback of [false, true]) {
        const id = randomUUID();
        const planned = createAccountEntities(
          input.accountType,
          null,
          id,
          input
        );
        assert.deepEqual(
          [
            planned.seat,
            planned.userChurchId,
            planned.sendingChurchId,
            planned.sendingNetworkId,
          ],
          [null, null, null, null]
        );
        assert.equal(planned.statements.length, 0);
        assert.equal(planned.linkStatements.length, 1);
        const statements = [
          db.insert(users).values({
            id,
            name: input.name,
            email: `${id}@example.test`,
            passwordHash: "scratch",
            seat: planned.seat,
            churchId: planned.userChurchId,
            sendingChurchId: planned.sendingChurchId,
            sendingNetworkId: planned.sendingNetworkId,
          }),
          ...planned.linkStatements,
          ...(rollback ? [db.execute(sql`select 1 / 0`)] : []),
        ] as const;
        if (rollback) await assert.rejects(db.batch(statements));
        else await db.batch(statements);
        assert.equal((await profile({ id })).length, rollback ? 0 : 1);
        assert.equal(
          (
            await db
              .select()
              .from(users)
              .where(sql`${users.id} = ${id}`)
          ).length,
          rollback ? 0 : 1
        );
        assert.equal(
          (
            await db
              .select()
              .from(persons)
              .where(sql`${persons.userId} = ${id}`)
          ).length,
          0
        );
      }
    });

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
      run: () => Promise<unknown[]>
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
      let contender: Promise<unknown[]> | undefined;
      try {
        await waitUntil(() => output.includes("locked"));
        contender = run();
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
        () => mutate(actor, createDiscoveryProfileStatement(actor))
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
          await behindConcurrentChange(actor, change, () =>
            mutate(actor, retireEmptyDiscoveryProfileStatement(actor))
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

    async function seatInvitation(
      actor: { id: string },
      destination: "church" | "network" = "church"
    ) {
      const { hashUserInvitationToken, describeUserInvitationForRegistration } =
        await import("../invitations/seat");
      const { acceptSeatInvitationStatements } =
        await import("../invitations/accept-seat");
      const token = randomUUID();
      const inviter = await account();
      const [plant] = await db
        .insert(churches)
        .values({
          name: "294 invited plant",
          onboardingCompletedAt: new Date(),
        })
        .returning();
      const [network] = await db
        .insert(sendingNetworks)
        .values({ name: "294 invited network" })
        .returning();
      const now = new Date();
      const [row] = await db
        .insert(userInvitations)
        .values({
          kind: "seat",
          seat: "member",
          inviterUserId: inviter.id,
          inviteeEmail: `${actor.id}@example.test`,
          tokenHash: hashUserInvitationToken(token),
          churchId: destination === "church" ? plant.id : null,
          sendingNetworkId: destination === "network" ? network.id : null,
          expiresAt: new Date(now.getTime() + 60_000),
        })
        .returning();
      const invitation = await describeUserInvitationForRegistration(
        token,
        now
      );
      assert.ok(invitation);
      const statements = () =>
        acceptSeatInvitationStatements(
          actor.id,
          token,
          invitation,
          null,
          { name: null, email: `${actor.id}@example.test` },
          now
        );
      return { row, statements, plant, network };
    }

    test("real seat acceptance refuses associations, then retires the empty profile with the grant", async () => {
      const [sender] = await db
        .insert(sendingChurches)
        .values({ name: "294 seat blocking sender" })
        .returning();
      const [sponsor] = await db
        .insert(sendingNetworks)
        .values({ name: "294 seat blocking network" })
        .returning();
      for (const associations of [
        { sendingChurchId: sender.id, sendingNetworkId: null },
        { sendingChurchId: null, sendingNetworkId: sponsor.id },
        { sendingChurchId: sender.id, sendingNetworkId: sponsor.id },
      ]) {
        const actor = await account();
        await mutate(actor, createDiscoveryProfileStatement(actor));
        const invitation = await seatInvitation(actor);
        await db
          .update(discoveryProfiles)
          .set(associations)
          .where(sql`${discoveryProfiles.userId} = ${actor.id}`);
        const [, refused] = await db.batch(invitation.statements());
        assert.equal(refused.rows.length, 0);
        assert.equal(
          (
            await db
              .select()
              .from(userInvitations)
              .where(sql`${userInvitations.id} = ${invitation.row.id}`)
          )[0].status,
          "pending"
        );
        assert.deepEqual(await profile(actor), [
          { userId: actor.id, ...associations },
        ]);
        assert.equal(
          (
            await db
              .select()
              .from(persons)
              .where(sql`${persons.userId} = ${actor.id}`)
          ).length,
          0
        );
        // Only the Leave lifecycle may do this in production; fixture setup
        // simulates its completed result without adding another sever writer.
        await db
          .update(discoveryProfiles)
          .set({ sendingChurchId: null, sendingNetworkId: null })
          .where(sql`${discoveryProfiles.userId} = ${actor.id}`);
        const [, granted] = await db.batch(invitation.statements());
        assert.equal(granted.rows.length, 1);
        assert.deepEqual(
          await db
            .select()
            .from(discoveryProfiles)
            .where(sql`${discoveryProfiles.userId} = ${actor.id}`),
          []
        );
        const [user] = await db
          .select()
          .from(users)
          .where(sql`${users.id} = ${actor.id}`);
        assert.equal(user.seat, "member");
        assert.equal(user.churchId, invitation.plant.id);
        assert.equal(user.sendingChurchId, null);
        assert.equal(user.sendingNetworkId, null);
        assert.equal(
          (
            await db
              .select()
              .from(persons)
              .where(sql`${persons.userId} = ${actor.id}`)
          ).length,
          1
        );
      }
    });

    test("invalidated token or address cannot retire a discovery profile", async () => {
      for (const invalidation of [
        "token",
        "email",
        "revoked",
        "expired",
        "scope",
        "seat",
      ] as const) {
        const actor = await account();
        await mutate(actor, createDiscoveryProfileStatement(actor));
        const invitation = await seatInvitation(actor);
        if (invalidation === "email") {
          await db
            .update(users)
            .set({ email: `${randomUUID()}@example.test` })
            .where(sql`${users.id} = ${actor.id}`);
        } else {
          await db
            .update(userInvitations)
            .set(
              invalidation === "token"
                ? { tokenHash: "0".repeat(64) }
                : invalidation === "expired"
                  ? { expiresAt: new Date(0) }
                  : invalidation === "scope"
                    ? {
                        churchId: null,
                        sendingNetworkId: invitation.network.id,
                      }
                    : invalidation === "seat"
                      ? { seat: "admin" }
                      : { status: "revoked" }
            )
            .where(sql`${userInvitations.id} = ${invitation.row.id}`);
        }
        const [, refused] = await db.batch(invitation.statements());
        assert.equal(refused.rows.length, 0);
        assert.equal((await profile(actor)).length, 1);
        assert.equal(
          (
            await db
              .select()
              .from(persons)
              .where(sql`${persons.userId} = ${actor.id}`)
          ).length,
          0
        );
        const [user] = await db
          .select()
          .from(users)
          .where(sql`${users.id} = ${actor.id}`);
        assert.equal(user.seat, null);
        assert.equal(user.churchId, null);
      }
    });

    test("seat grant rollback restores discovery and invitation; no-profile accounts still accept", async () => {
      const actor = await account();
      await mutate(actor, createDiscoveryProfileStatement(actor));
      const invitation = await seatInvitation(actor);
      await assert.rejects(
        db.batch([...invitation.statements(), db.execute(sql`select 1/0`)]),
        sqlState("22012")
      );
      assert.equal((await profile(actor)).length, 1);
      assert.equal(
        (
          await db
            .select()
            .from(userInvitations)
            .where(sql`${userInvitations.id} = ${invitation.row.id}`)
        )[0].status,
        "pending"
      );
      assert.equal(
        (
          await db
            .select()
            .from(persons)
            .where(sql`${persons.userId} = ${actor.id}`)
        ).length,
        0
      );
      const noProfile = await account();
      const orgInvitation = await seatInvitation(noProfile, "network");
      const [, granted] = await db.batch(orgInvitation.statements());
      assert.equal(granted.rows.length, 1);
      const [user] = await db
        .select()
        .from(users)
        .where(sql`${users.id} = ${noProfile.id}`);
      assert.equal(user.sendingNetworkId, orgInvitation.network.id);
      assert.equal(
        (
          await db
            .select()
            .from(persons)
            .where(sql`${persons.userId} = ${noProfile.id}`)
        ).length,
        0
      );
    });

    test("real seat claim rechecks associations after lock contention", async () => {
      const [sender] = await db
        .insert(sendingChurches)
        .values({ name: "294 concurrent seat sender" })
        .returning();
      const [network] = await db
        .insert(sendingNetworks)
        .values({ name: "294 concurrent seat network" })
        .returning();
      for (const field of [
        "sending_church_id",
        "sending_network_id",
      ] as const) {
        const actor = await account();
        await mutate(actor, createDiscoveryProfileStatement(actor));
        const invitation = await seatInvitation(actor);
        const result = await behindConcurrentChange(
          actor,
          `update discovery_profiles set ${field}='${field === "sending_church_id" ? sender.id : network.id}' where user_id='${actor.id}'`,
          async () => {
            const [, granted] = await db.batch(invitation.statements());
            return granted.rows;
          }
        );
        assert.deepEqual(result, []);
        assert.equal((await profile(actor)).length, 1);
        assert.equal(
          (
            await db
              .select()
              .from(userInvitations)
              .where(sql`${userInvitations.id} = ${invitation.row.id}`)
          )[0].status,
          "pending"
        );
        assert.equal(
          (
            await db
              .select()
              .from(persons)
              .where(sql`${persons.userId} = ${actor.id}`)
          ).length,
          0
        );
      }
    });

    test("two real seat invitations have one token, tenancy and person winner", async () => {
      const actor = await account();
      await mutate(actor, createDiscoveryProfileStatement(actor));
      const invitations = await Promise.all([
        seatInvitation(actor),
        seatInvitation(actor),
      ]);
      const results = await Promise.all(
        invitations.map((invitation) => db.batch(invitation.statements()))
      );
      assert.equal(
        results.reduce((count, [, granted]) => count + granted.rows.length, 0),
        1
      );
      const rows = await db
        .select()
        .from(userInvitations)
        .where(
          sql`${userInvitations.respondedBy} = ${actor.id} and ${userInvitations.status} = 'accepted'`
        );
      assert.equal(rows.length, 1);
      const [user] = await db
        .select()
        .from(users)
        .where(sql`${users.id} = ${actor.id}`);
      assert.equal(user.churchId, rows[0].churchId);
      const linked = await db
        .select()
        .from(persons)
        .where(sql`${persons.userId} = ${actor.id}`);
      assert.equal(linked.length, 1);
      assert.equal(linked[0].churchId, user.churchId);
      assert.deepEqual(
        await db
          .select()
          .from(discoveryProfiles)
          .where(sql`${discoveryProfiles.userId} = ${actor.id}`),
        []
      );
    });
  }
);
